import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("com.google.devtools.ksp")
}

android {
    namespace = "com.priyanshuraj.jarviscompanion"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.priyanshuraj.jarviscompanion"
        minSdk = 26
        targetSdk = 36
        versionCode = 7
        versionName = "0.8.2-release-candidate"
    }

    // Production signing material is injected only by the protected release workflow.
    // Debug builds remain usable without any signing secrets.
    signingConfigs {
        create("release") {
            val keystorePath = providers.environmentVariable("ANDROID_SIGNING_KEYSTORE_PATH").orNull
            if (!keystorePath.isNullOrBlank()) {
                storeFile = file(keystorePath)
            }
            storePassword = providers.environmentVariable("ANDROID_SIGNING_STORE_PASSWORD").orNull
            keyAlias = providers.environmentVariable("ANDROID_SIGNING_KEY_ALIAS").orNull
            keyPassword = providers.environmentVariable("ANDROID_SIGNING_KEY_PASSWORD").orNull
        }
    }

    buildTypes {
        getByName("release") {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.fromTarget("17")
    }
}


dependencies {
    implementation("androidx.room:room-runtime:2.8.5")
    // Bundled OCR models keep screen text recognition on-device and available offline.
    implementation("com.google.mlkit:text-recognition:16.0.1")
    implementation("com.google.mlkit:text-recognition-devanagari:16.0.1")
    ksp("androidx.room:room-compiler:2.8.5")

    testImplementation("org.robolectric:robolectric:4.17")
    testImplementation("junit:junit:4.13.2")
    // Android local unit tests use the real JVM JSON implementation, not android.jar stubs.
    testImplementation("org.json:json:20260814")
}


val validateReleaseSigning = tasks.register("validateReleaseSigning") {
    doLast {
        val required = listOf(
            "ANDROID_SIGNING_KEYSTORE_PATH",
            "ANDROID_SIGNING_STORE_PASSWORD",
            "ANDROID_SIGNING_KEY_ALIAS",
            "ANDROID_SIGNING_KEY_PASSWORD"
        )
        val missing = required.filter { System.getenv(it).isNullOrBlank() }
        if (missing.isNotEmpty()) {
            throw GradleException("Release signing is not configured. Missing environment values: " + missing.joinToString(", "))
        }
        val keystore = file(System.getenv("ANDROID_SIGNING_KEYSTORE_PATH")!!)
        if (!keystore.isFile || keystore.length() <= 0L) {
            throw GradleException("The configured Android release keystore file is missing or empty.")
        }
    }
}

tasks.matching { it.name == "validateSigningRelease" }.configureEach {
    dependsOn(validateReleaseSigning)
}
