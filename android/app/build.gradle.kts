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
        versionCode = 2
        versionName = "0.2.1-phase21"
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


dependencies {
    testImplementation("junit:junit:4.13.2")
    // Android local unit tests use the real JVM JSON implementation, not android.jar stubs.
    testImplementation("org.json:json:20240303")
}
