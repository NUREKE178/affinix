package space.affinix.app.net

import io.ktor.client.HttpClient
import io.ktor.client.plugins.HttpTimeout

/** The engine (OkHttp) is picked up from the platform's classpath. */
fun httpClient(): HttpClient = HttpClient {
    install(HttpTimeout) { connectTimeoutMillis = 10_000; requestTimeoutMillis = 40_000; socketTimeoutMillis = 40_000 }
}
