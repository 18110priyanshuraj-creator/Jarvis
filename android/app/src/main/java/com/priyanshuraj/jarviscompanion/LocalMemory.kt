package com.priyanshuraj.jarviscompanion

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Update
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.security.MessageDigest
import java.text.Normalizer
import java.util.Locale
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

private const val LOCAL_MEMORY_DATABASE_NAME = "jarvis_local_memory.db"
private const val LOCAL_MEMORY_KEY_ALIAS = "jarvis.local-memory.content.v1"
private const val MAX_LOCAL_MEMORY_CONTENT = 500
private const val MAX_LOCAL_MEMORIES = 200

@Entity(
    tableName = "local_memories",
    indices = [
        Index(value = ["contentHash"], unique = true),
        Index(value = ["updatedAtEpochMs"])
    ]
)
data class LocalMemoryEntity(
    @PrimaryKey val id: String,
    val encryptedContent: String,
    val contentHash: String,
    val category: String,
    val enabled: Boolean,
    val createdAtEpochMs: Long,
    val updatedAtEpochMs: Long
)

@Dao
interface LocalMemoryDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    fun insert(memory: LocalMemoryEntity): Long

    @Update
    fun update(memory: LocalMemoryEntity): Int

    @Query("SELECT * FROM local_memories ORDER BY updatedAtEpochMs DESC, id DESC LIMIT :limit")
    fun latest(limit: Int): List<LocalMemoryEntity>

    @Query("SELECT * FROM local_memories WHERE id = :id LIMIT 1")
    fun findById(id: String): LocalMemoryEntity?

    @Query("SELECT * FROM local_memories WHERE contentHash = :hash LIMIT 1")
    fun findByHash(hash: String): LocalMemoryEntity?

    @Query("SELECT COUNT(*) FROM local_memories")
    fun count(): Int

    @Query("DELETE FROM local_memories WHERE id = :id")
    fun deleteById(id: String): Int
}

@Database(entities = [LocalMemoryEntity::class], version = 1, exportSchema = false)
abstract class LocalMemoryDatabase : RoomDatabase() {
    abstract fun localMemoryDao(): LocalMemoryDao
}

/** Only encrypted payloads are persisted. Tests inject a JVM cipher; production uses Android Keystore. */
interface LocalMemoryCipher {
    fun encrypt(plainText: String): String
    fun decrypt(encryptedText: String): String
}

class AndroidKeystoreMemoryCipher(
    private val alias: String = LOCAL_MEMORY_KEY_ALIAS
) : LocalMemoryCipher {
    override fun encrypt(plainText: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, loadOrCreateKey())
        val encrypted = cipher.doFinal(plainText.toByteArray(StandardCharsets.UTF_8))
        val iv = Base64.encodeToString(cipher.iv, Base64.NO_WRAP)
        val payload = Base64.encodeToString(encrypted, Base64.NO_WRAP)
        return "v1:$iv:$payload"
    }

    override fun decrypt(encryptedText: String): String {
        val parts = encryptedText.split(':', limit = 3)
        if (parts.size != 3 || parts[0] != "v1") {
            throw IllegalStateException("The local memory record has an unsupported encryption format.")
        }
        val iv = Base64.decode(parts[1], Base64.NO_WRAP)
        val payload = Base64.decode(parts[2], Base64.NO_WRAP)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, loadOrCreateKey(), GCMParameterSpec(128, iv))
        return String(cipher.doFinal(payload), StandardCharsets.UTF_8)
    }

    private fun loadOrCreateKey(): SecretKey = synchronized(KEY_LOCK) {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        val existing = keyStore.getKey(alias, null) as? SecretKey
        if (existing != null) return@synchronized existing

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        )
        generator.generateKey()
    }

    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private val KEY_LOCK = Any()
    }
}

data class LocalMemoryNote(
    val id: String,
    val content: String,
    val category: String,
    val enabled: Boolean,
    val createdAtEpochMs: Long,
    val updatedAtEpochMs: Long
)

class LocalMemoryRepository(
    private val dao: LocalMemoryDao,
    private val cipher: LocalMemoryCipher,
    private val now: () -> Long = { System.currentTimeMillis() }
) {
    fun save(contentInput: String, categoryInput: String = "fact"): LocalMemoryNote {
        val content = validateAndNormalizeContent(contentInput)
        val hash = contentHash(content)
        if (dao.findByHash(hash) != null) {
            throw IllegalStateException("That memory is already saved on this tablet.")
        }
        if (dao.count() >= MAX_LOCAL_MEMORIES) {
            throw IllegalStateException("Local memory is full. Delete an older note before saving another.")
        }

        val timestamp = now().coerceAtLeast(0L)
        val row = LocalMemoryEntity(
            id = UUID.randomUUID().toString(),
            encryptedContent = cipher.encrypt(content),
            contentHash = hash,
            category = normalizeCategory(categoryInput),
            enabled = true,
            createdAtEpochMs = timestamp,
            updatedAtEpochMs = timestamp
        )
        if (dao.insert(row) < 0L) {
            throw IllegalStateException("That memory is already saved on this tablet.")
        }
        return row.toNote()
    }

    fun update(id: String, contentInput: String, categoryInput: String): LocalMemoryNote {
        val existing = dao.findById(id) ?: throw IllegalArgumentException("Local memory not found.")
        val content = validateAndNormalizeContent(contentInput)
        val hash = contentHash(content)
        val duplicate = dao.findByHash(hash)
        if (duplicate != null && duplicate.id != id) {
            throw IllegalStateException("Another local memory already contains that note.")
        }

        val updated = existing.copy(
            encryptedContent = cipher.encrypt(content),
            contentHash = hash,
            category = normalizeCategory(categoryInput),
            updatedAtEpochMs = now().coerceAtLeast(existing.updatedAtEpochMs)
        )
        if (dao.update(updated) == 0) throw IllegalStateException("The local memory could not be updated.")
        return updated.toNote()
    }

    fun setEnabled(id: String, enabled: Boolean): LocalMemoryNote {
        val existing = dao.findById(id) ?: throw IllegalArgumentException("Local memory not found.")
        val updated = existing.copy(
            enabled = enabled,
            updatedAtEpochMs = now().coerceAtLeast(existing.updatedAtEpochMs)
        )
        if (dao.update(updated) == 0) throw IllegalStateException("The local memory setting could not be changed.")
        return updated.toNote()
    }

    fun delete(id: String): Boolean = dao.deleteById(id) > 0

    /** Exact normalized matching only; broad or partial requests never delete a note. */
    fun forgetExact(contentInput: String): Boolean {
        val candidate = normalizeMemoryText(contentInput)
        if (candidate.length < 3 || candidate.length > MAX_LOCAL_MEMORY_CONTENT) return false
        val row = dao.findByHash(contentHash(candidate)) ?: return false
        if (normalizeMemoryText(cipher.decrypt(row.encryptedContent)) != candidate) return false
        return dao.deleteById(row.id) > 0
    }

    fun list(query: String = "", limit: Int = MAX_LOCAL_MEMORIES): List<LocalMemoryNote> =
        search(query, limit, includePaused = true)

    fun search(
        query: String,
        limit: Int = 5,
        includePaused: Boolean = true
    ): List<LocalMemoryNote> {
        val safeLimit = limit.coerceIn(1, MAX_LOCAL_MEMORIES)
        val all = dao.latest(MAX_LOCAL_MEMORIES).map { it.toNote() }
            .filter { includePaused || it.enabled }

        val normalizedQuery = normalizeMemoryText(query)
        if (normalizedQuery.isBlank()) return all.take(safeLimit)

        val terms = memoryTerms(normalizedQuery)
        if (terms.isEmpty()) return emptyList()
        return all.mapNotNull { note ->
            val content = normalizeMemoryText(note.content)
            val words = memoryTerms(content).toSet()
            val matched = terms.filter { term ->
                words.any { word ->
                    word == term || (word.length >= 4 && term.length >= 4 && (word.startsWith(term) || term.startsWith(word)))
                }
            }
            val coverage = matched.size.toDouble() / terms.size.toDouble()
            if (coverage < 0.34) return@mapNotNull null
            val score = matched.size * 4 + if (content.contains(normalizedQuery)) 4 else 0
            Triple(note, score, coverage)
        }.sortedWith(
            compareByDescending<Triple<LocalMemoryNote, Int, Double>> { it.second }
                .thenByDescending { it.third }
                .thenByDescending { it.first.updatedAtEpochMs }
        ).take(safeLimit).map { it.first }
    }

    private fun LocalMemoryEntity.toNote() = LocalMemoryNote(
        id = id,
        content = cipher.decrypt(encryptedContent),
        category = category,
        enabled = enabled,
        createdAtEpochMs = createdAtEpochMs,
        updatedAtEpochMs = updatedAtEpochMs
    )

    companion object {
        const val MAX_CONTENT = MAX_LOCAL_MEMORY_CONTENT
        const val MAX_ITEMS = MAX_LOCAL_MEMORIES

        private val sensitivePattern = Regex(
            """\b(password|passcode|pin|otp|one[- ]time code|api[_ -]?key|secret|access[_ -]?token|private key|bank account|card number|medical|health|diagnos(?:is|ed)|medicine|medication|home address|exact address|street address|phone number|email address|date of birth|birth date|race|ethnicity|religion|religious belief|political affiliation|political party|voting preference|sexual orientation|sexuality|sex life|trade union|union membership|criminal history|immigration status|biometric|mental health|disability)\b""",
            RegexOption.IGNORE_CASE
        )
        private val googleApiKeyPattern = Regex("""\bAIza[0-9A-Za-z_-]{30,}\b""")
        private val bearerPattern = Regex("""\bBearer\s+[A-Za-z0-9._~+/-]{24,}""", RegexOption.IGNORE_CASE)
        private val allowedCategories = setOf("preference", "goal", "fact")
        private val stopWords = setOf(
            "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "could",
            "did", "do", "does", "for", "from", "had", "has", "have", "how", "i",
            "if", "in", "into", "is", "it", "its", "me", "my", "of", "on", "or",
            "our", "please", "the", "their", "them", "there", "these", "this", "those",
            "to", "us", "was", "we", "were", "what", "when", "where", "which", "who",
            "why", "will", "with", "would", "you", "your", "jarvis", "remember",
            "hai", "hain", "ka", "ki", "ke", "ko", "mein", "mai", "main", "mera",
            "meri", "mere", "mujhe", "mujhko", "kya", "kyu", "kyon", "aur", "ye",
            "yeh", "woh", "wo", "par", "se", "bhi", "ek", "tha", "thi", "the",
            "है", "हैं", "का", "की", "के", "को", "में", "मैं", "मेरा", "मेरी",
            "मुझे", "क्या", "और", "यह", "वह", "पर", "से", "भी", "एक"
        )

        fun validateAndNormalizeContent(value: String): String {
            val content = value.trim().replace(Regex("\\s+"), " ").let {
                Normalizer.normalize(it, Normalizer.Form.NFKC)
            }
            require(content.length in 3..MAX_LOCAL_MEMORY_CONTENT) {
                "A local memory must contain 3–500 characters."
            }
            require(
                !sensitivePattern.containsMatchIn(content) &&
                    !googleApiKeyPattern.containsMatchIn(content) &&
                    !bearerPattern.containsMatchIn(content)
            ) {
                "For privacy, JARVIS will not save passwords, secrets, contact details, health details or other sensitive personal information."
            }
            return content
        }

        fun normalizeMemoryText(value: String): String =
            Normalizer.normalize(value, Normalizer.Form.NFKC)
                .lowercase(Locale.ROOT)
                .replace(Regex("\\s+"), " ")
                .trim()

        private fun contentHash(content: String): String {
            val digest = MessageDigest.getInstance("SHA-256")
                .digest(normalizeMemoryText(content).toByteArray(StandardCharsets.UTF_8))
            return digest.joinToString("") { byte -> "%02x".format(byte) }
        }

        private fun normalizeCategory(value: String): String =
            value.trim().lowercase(Locale.ROOT).takeIf { it in allowedCategories } ?: "fact"

        private fun memoryTerms(value: String): List<String> =
            Regex("""[\p{L}\p{N}]+""").findAll(value)
                .map { it.value }
                .filter { it.length > 1 && it !in stopWords }
                .distinct()
                .toList()
    }
}

/** Separate file/database: no Room migration and no import from server-side app state. */
class LocalMemoryRuntime(context: Context) : AutoCloseable {
    private val database = Room.databaseBuilder(
        context.applicationContext,
        LocalMemoryDatabase::class.java,
        LOCAL_MEMORY_DATABASE_NAME
    ).build()

    val repository = LocalMemoryRepository(database.localMemoryDao(), AndroidKeystoreMemoryCipher())

    override fun close() {
        database.close()
    }
}

/** Memory commands are deliberately local-only and require an explicit Remember command. */
class LocalMemoryCommandHandler(private val repository: LocalMemoryRepository) {
    private val rememberPattern = Regex(
        """^(?:please\s+)?(?:remember|save to memory|yaad rakho|yaad rakhna)(?:\s+(?:my\s+)?(preference|goal|fact))?\s*[:,-]?\s*(?:that\s+)?(.+)$""",
        RegexOption.IGNORE_CASE
    )
    private val forgetPattern = Regex(
        """^(?:please\s+)?forget(?:\s+(?:that|this))?\s*[:,-]?\s*(.*)$|^(?:bhool jao|yaad se hatao)\s*[:,-]?\s*(.*)$""",
        RegexOption.IGNORE_CASE
    )
    private val recallPattern = Regex(
        """^(?:recall|search memory(?: for)?|what do you remember(?: about)?|kya yaad hai|yaad hai)\s*(.*)$""",
        RegexOption.IGNORE_CASE
    )

    fun handle(message: String): String? {
        val input = message.trim()
        if (input.isBlank()) return null

        val remember = rememberPattern.matchEntire(input)
        if (remember != null) {
            val category = remember.groupValues[1].ifBlank { "fact" }
            val content = remember.groupValues[2]
            return runCatching {
                val note = repository.save(content, category)
                "Saved locally on this tablet under " + note.category + ". It was not sent to the JARVIS server."
            }.getOrElse { it.message ?: "The local memory could not be saved." }
        }

        val forget = forgetPattern.matchEntire(input)
        if (forget != null) {
            val content = (forget.groupValues.getOrNull(1).orEmpty().ifBlank {
                forget.groupValues.getOrNull(2).orEmpty()
            }).trim().trim('"', '\'', '“', '”', '‘', '’')
            val broad = content.lowercase(Locale.ROOT) in setOf(
                "all", "everything", "all memories", "sab", "sab kuch", "saari memories", "sabhi memories"
            )
            if (content.length < 3 || broad) {
                return "For safety, JARVIS only forgets one exact saved note at a time. Open Local Memory to review and delete notes."
            }
            return runCatching {
                if (repository.forgetExact(content)) "That exact local memory has been deleted from this tablet."
                else "No exact matching local memory was found. Nothing was deleted."
            }.getOrElse { it.message ?: "The local memory could not be deleted." }
        }

        val normalized = input.lowercase(Locale.ROOT).replace(Regex("\\s+"), " ").trim()
        val listRequest = normalized in setOf(
            "list memories", "list my memories", "show memories", "show my memories",
            "meri yaadein dikhao", "meri memories dikhao", "what do you remember"
        )
        val recall = recallPattern.matchEntire(input)
        if (!listRequest && recall == null) return null

        val query = if (listRequest) "" else recall?.groupValues?.getOrNull(1).orEmpty()
        return runCatching {
            val matches = repository.search(query, limit = 5, includePaused = false)
            if (matches.isEmpty()) {
                "I could not find a matching on-device memory. Local memories are separate from the server workspace."
            } else {
                "Your active on-device memories:\n" +
                    matches.joinToString("\n") {
                        "- [" + it.category + (if (it.enabled) "" else ", paused") + "] " + it.content
                    }
            }
        }.getOrElse { it.message ?: "The local memory store could not be read." }
    }
}
