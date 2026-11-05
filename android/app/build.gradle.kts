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
        versionCode = 6
        versionName = "0.8.1-web-workspace"
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
