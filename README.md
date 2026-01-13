# Demo: Opis obrazu w przeglądarce (transformers.js + WebGPU)

Lokalny demo projekt, który uruchamia captioning obrazu bez wysyłania danych na serwer. UI umożliwia upload/drag & drop, kontrolę parametrów generacji oraz podgląd historii.

## Demo (GitHub Pages)

➡️ https://<your-github-username>.github.io/aji-vision-demo/

> Podmień `<your-github-username>` na nazwę użytkownika/organizacji po uruchomieniu Pages.

## Uruchomienie lokalne

```bash
python -m http.server 4173
```

Następnie przejdź do `http://localhost:4173/`.

## Deploy (GitHub Pages)

Workflow znajduje się w `.github/workflows/deploy.yml`. Po każdym pushu do gałęzi `main` (lub ręcznym uruchomieniu) następuje budowa artefaktu (statyczne pliki) i deploy na GitHub Pages.
