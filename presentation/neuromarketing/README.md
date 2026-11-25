# Нейромаркетинг презентациясы (10 слайд, Affinix стилі)

`neuromarketing.pptx` файлын PowerPoint немесе WPS-та ашыңыз. Анимация слайдқа кіргенде өзі ойнайды.

**Алдымен шрифттерді орнатыңыз:** `fonts/` ішіндегі Rubik пен JetBrains Mono файлдарын (OFL лицензиясы бойынша тегін).
Орнатылмаса, PowerPoint басқа шрифт қояды да, мәтін ығысып кетуі мүмкін.

Дизайн Affinix-тің «Instrument» стилінде: графит фон, күңгірт пластиналар, бір сигнал түсі #ff6a1f, LED индикаторлары, сандар mono шрифтімен.

Қайта жинау үшін `.claude/skills/animated-native-pptx` скилі керек:

```bash
cp ../../.claude/skills/animated-native-pptx/scripts/{deckkit.py,assets.js} .
python3 make_theme.py && NODE_PATH=$(npm root -g) node assets.js && python3 build.py
```
