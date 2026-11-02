package com.priyanshuraj.jarviscompanion

import androidx.room.Room
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.util.Base64
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class LocalMemoryRepositoryTest {
    private val app = RuntimeEnvironment.getApplication()
    private val databaseName = "jarvis-local-memory-test-" + UUID.randomUUID() + ".db"
    private var database: LocalMemoryDatabase? = null
    private lateinit var repository: LocalMemoryRepository
    private var clock = 10_000L

    @Before
    fun openDatabase() {
        database = Room.databaseBuilder(app, LocalMemoryDatabase::class.java, databaseName)
            .allowMainThreadQueries()
            .build()
        repository = LocalMemoryRepository(
            requireNotNull(database).localMemoryDao(),
            TestLocalMemoryCipher(),
            now = { clock }
        )
    }

    @After
    fun closeDatabase() {
        database?.close()
        app.deleteDatabase(databaseName)
    }

    @Test
    fun savePersistsOnlyCiphertextAndSurvivesDatabaseReopen() {
        val note = repository.save("I prefer concise Hinglish examples", "preference")
        val stored = requireNotNull(database).localMemoryDao().findById(note.id)
        assertNotEquals(note.content, stored?.encryptedContent)
        assertFalse(requireNotNull(stored).encryptedContent.contains("Hinglish"))

        database?.close()
        database = Room.databaseBuilder(app, LocalMemoryDatabase::class.java, databaseName)
            .allowMainThreadQueries()
            .build()
        repository = LocalMemoryRepository(requireNotNull(database).localMemoryDao(), TestLocalMemoryCipher(), now = { clock })

        assertEquals(note.content, repository.list().single().content)
        assertEquals("preference", repository.list().single().category)
    }

    @Test
    fun contentIsNormalizedDeduplicatedAndBounded() {
        val first = repository.save("  I   prefer clear examples  ", "preference")
        assertEquals("I prefer clear examples", first.content)
        try {
            repository.save("i prefer CLEAR examples", "preference")
            throw AssertionError("A normalized duplicate should not be inserted.")
        } catch (error: IllegalStateException) {
            assertTrue(error.message.orEmpty().contains("already saved"))
        }
        assertEquals(1, repository.list().size)
        assertTrue(LocalMemoryRepository.MAX_ITEMS >= repository.list().size)
        assertEquals(500, LocalMemoryRepository.validateAndNormalizeContent("x".repeat(500)).length)
    }

    @Test
    fun privacyFilterRejectsCredentialsAndSensitivePersonalDetails() {
        val rejected = listOf(
            "My password is example123",
            "My medical diagnosis is private",
            "My exact home address is private",
            "My phone number is 1234567890",
            "My religion is private"
        )
        rejected.forEach { value ->
            try {
                repository.save(value)
                throw AssertionError("Sensitive memory should be rejected: " + value)
            } catch (error: IllegalArgumentException) {
                assertTrue(error.message.orEmpty().contains("privacy"))
            }
        }
        assertTrue(LocalMemoryRepository.validateAndNormalizeContent("I prefer short study plans").isNotBlank())
        assertTrue(repository.list().isEmpty())
    }

    @Test
    fun pauseAndResumeOnlyAffectWhetherNoteIsIncludedInActiveSearch() {
        val active = repository.save("I prefer short physics explanations", "preference")
        val paused = repository.save("I prefer detailed chemistry examples", "preference")
        repository.setEnabled(paused.id, false)

        assertEquals(listOf(active.id), repository.search("physics explanations", 5, includePaused = false).map { it.id })
        assertEquals(2, repository.list().size)
        assertFalse(repository.list().first { it.id == paused.id }.enabled)

        repository.setEnabled(paused.id, true)
        assertTrue(repository.list().first { it.id == paused.id }.enabled)
    }

    @Test
    fun searchRanksRelevantNotesAndHonorsTheRequestedLimit() {
        repository.save("I prefer short Hinglish explanations", "preference")
        repository.save("Practice algebra every morning", "goal")
        repository.save("I enjoy science documentaries", "fact")

        val matches = repository.search("Hinglish explanations", limit = 1)
        assertEquals(1, matches.size)
        assertTrue(matches.single().content.contains("Hinglish"))
        assertTrue(repository.search("unrelated volcano facts", 5).isEmpty())
    }

    @Test
    fun editsKeepTheOriginalIdAndExactForgetNeverUsesPartialMatches() {
        val saved = repository.save("I prefer short explanations", "preference")
        clock += 500
        val edited = repository.update(saved.id, "I prefer step by step explanations", "preference")
        assertEquals(saved.id, edited.id)
        assertTrue(edited.updatedAtEpochMs >= saved.updatedAtEpochMs)
        assertFalse(repository.forgetExact("I prefer step by step"))
        assertEquals(1, repository.list().size)
        assertTrue(repository.forgetExact("  I   prefer STEP by step explanations "))
        assertTrue(repository.list().isEmpty())
    }

    @Test
    fun localMemoryCommandsAreExplicitAndNeverDeleteAllNotes() {
        val handler = LocalMemoryCommandHandler(repository)
        assertTrue(handler.handle("Remember preference: I prefer clear explanations").orEmpty().contains("Saved locally"))
        assertTrue(handler.handle("recall clear explanations").orEmpty().contains("clear explanations"))
        assertTrue(handler.handle("Forget everything").orEmpty().contains("one exact saved note"))
        assertEquals(1, repository.list().size)
        assertNull(handler.handle("Explain gravity"))
        assertTrue(handler.handle("Forget: I prefer clear explanations").orEmpty().contains("deleted"))
        assertTrue(repository.list().isEmpty())
    }

    private class TestLocalMemoryCipher : LocalMemoryCipher {
        private val key = SecretKeySpec(ByteArray(32) { (it + 7).toByte() }, "AES")

        override fun encrypt(plainText: String): String {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key)
            val iv = cipher.iv
            val payload = cipher.doFinal(plainText.toByteArray(Charsets.UTF_8))
            return "test:" + Base64.getEncoder().encodeToString(iv) + ":" +
                Base64.getEncoder().encodeToString(payload)
        }

        override fun decrypt(encryptedText: String): String {
            val parts = encryptedText.split(':', limit = 3)
            require(parts.size == 3 && parts[0] == "test")
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(
                Cipher.DECRYPT_MODE,
                key,
                GCMParameterSpec(128, Base64.getDecoder().decode(parts[1]))
            )
            return String(cipher.doFinal(Base64.getDecoder().decode(parts[2])), Charsets.UTF_8)
        }
    }
}
