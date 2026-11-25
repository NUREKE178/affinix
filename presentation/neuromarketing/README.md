# Нейромаркетинг және цифрлық алгоритмдер — презентация (12 слайд, Affinix стилі)

`neuromarketing.pptx` файлын PowerPoint немесе WPS-та ашыңыз. Анимация слайдқа кіргенде өзі ойнайды.

**Алдымен шрифттерді орнатыңыз:** `fonts/` ішіндегі Rubik пен JetBrains Mono файлдарын (OFL лицензиясы бойынша тегін).
Орнатылмаса, PowerPoint басқа шрифт қояды да, мәтін ығысып кетуі мүмкін.

Дизайн Affinix-тің «Instrument» стилінде: графит фон, күңгірт пластиналар, бір сигнал түсі #ff6a1f, LED индикаторлары, сандар mono шрифтімен.

Қайта жинау үшін `.claude/skills/animated-native-pptx` скилі керек:

```bash
cp ../../.claude/skills/animated-native-pptx/scripts/{deckkit.py,assets.js} .
python3 make_theme.py && NODE_PATH=$(npm root -g) node assets.js && NODE_PATH=$(npm root -g) node brain.js && python3 build.py
```

1–5 слайдтың құрылымы мен сандары (93,4%, 80,8%, 6,25 трлн, 84%, 83/46/9%, Netflix 80%, YouTube 70%, 85%)
пайдаланушының «Цифрлық таңдау архитектурасы» PDF-інен алынды; дереккөздерін баяндамашы өзі тексеруі керек.
