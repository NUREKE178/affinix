val withAndroid = (findProperty("withAndroid") as String?) == "true"

buildscript {
    repositories {
        gradlePluginPortal()
        mavenCentral()
        if ((findProperty("withAndroid") as String?) == "true") google()
    }
    dependencies {
        if ((findProperty("withAndroid") as String?) == "true") classpath("com.android.tools.build:gradle:8.5.2")
    }
}

plugins {
    kotlin("multiplatform") version "2.0.21" apply false
    kotlin("plugin.serialization") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
    id("org.jetbrains.compose") version "1.7.1" apply false
}
