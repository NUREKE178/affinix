package space.affinix.app.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.painterResource
import space.affinix.app.i18n.t
import space.affinix.app.res.Res
import space.affinix.app.res.logo
import space.affinix.app.store.AppModel

private enum class AuthMode { Login, Register, Forgot }

@Composable
fun LoginScreen(model: AppModel) {
    var mode by remember { mutableStateOf(AuthMode.Login) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var info by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val checkEmail = t("auth.register.checkEmailSent", "email" to email.trim())
    val forgotSent = t("auth.forgot.sentMessage", "email" to email.trim())

    fun submit() {
        if (busy || email.isBlank() || (mode != AuthMode.Forgot && password.length < 6)) return
        busy = true; message = null; info = null
        scope.launch {
            val err = when (mode) {
                AuthMode.Forgot -> model.recover(email).also { if (it == null) info = forgotSent }
                else -> model.authenticate(email, password, mode == AuthMode.Register).also { if (it == "CONFIRM") info = checkEmail }
            }
            message = err?.takeIf { it != "CONFIRM" }
            busy = false
        }
    }

    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Plate(Modifier.widthIn(max = 420.dp).fillMaxWidth(), radius = 22, pad = 26) {
                Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Image(painterResource(Res.drawable.logo), null, Modifier.size(64.dp))
                    Spacer(Modifier.height(6.dp))
                    Txt(
                        when (mode) { AuthMode.Login -> t("auth.login.title"); AuthMode.Register -> t("auth.register.title"); AuthMode.Forgot -> t("auth.forgot.title") },
                        24, FontWeight.ExtraBold, C.g50, align = TextAlign.Center,
                    )
                    Txt(
                        when (mode) { AuthMode.Login -> t("auth.login.subtitle"); AuthMode.Register -> t("auth.register.subtitle"); AuthMode.Forgot -> t("auth.forgot.subtitle") },
                        14, FontWeight.Normal, C.g400, align = TextAlign.Center,
                    )
                }
                Spacer(Modifier.height(20.dp))
                Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Field(email, { email = it }, t("auth.fields.email"), email = true, imeDone = mode == AuthMode.Forgot, onDone = ::submit)
                    if (mode != AuthMode.Forgot) {
                        Field(password, { password = it }, t("auth.fields.password"), password = true, onDone = ::submit)
                        if (mode == AuthMode.Register) Txt(t("auth.fields.passwordHint"), 12, color = C.g500)
                    }
                    message?.let { Txt(it, 13, FontWeight.Medium, C.bad) }
                    info?.let { Txt(it, 13, FontWeight.Medium, C.ok) }
                    KeyButton(
                        when (mode) {
                            AuthMode.Login -> if (busy) t("auth.login.submitting") else t("auth.login.submit")
                            AuthMode.Register -> if (busy) t("auth.register.submitting") else t("auth.register.submit")
                            AuthMode.Forgot -> if (busy) t("auth.forgot.submitting") else t("auth.forgot.submit")
                        },
                        ::submit, Modifier.fillMaxWidth(), lit = true, enabled = !busy, big = true,
                    )
                }
                Spacer(Modifier.height(12.dp))
                Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                    when (mode) {
                        AuthMode.Login -> {
                            LinkText(t("auth.login.forgotPassword"), { mode = AuthMode.Forgot; message = null; info = null })
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Txt(t("auth.login.noAccount"), 14, color = C.g500)
                                LinkText(t("auth.login.register"), { mode = AuthMode.Register; message = null; info = null }, color = C.signalHi)
                            }
                        }
                        AuthMode.Register -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Txt(t("auth.register.haveAccount"), 14, color = C.g500)
                            LinkText(t("auth.register.login"), { mode = AuthMode.Login; message = null; info = null }, color = C.signalHi)
                        }
                        AuthMode.Forgot -> LinkText(t("auth.forgot.back"), { mode = AuthMode.Login; message = null; info = null })
                    }
                }
            }
            Spacer(Modifier.height(18.dp))
            LangSwitch(model.lang, model::changeLang)
        }
    }
}
