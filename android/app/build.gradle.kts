import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.priyanshuraj.jarviscompanion"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.priyanshuraj.jarviscompanion"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0-phase2"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.fromTarget("17")
    }
}
