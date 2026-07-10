# KKTC Enflasyon Takip Dashboard

KKTC İstatistik Kurumu'nun aylık Tüketici Fiyat Endeksi (TÜFE) bültenlerini
otomatik takip eden, GitHub Pages üzerinde yayınlanan bir dashboard.

## Nasıl çalışır

1. `scripts/update.mjs`, KKTC İstatistik Kurumu'nun haber RSS akışını
   (`https://istatistik.gov.ct.tr/HABERLER/rss/category/4213/haberler`) çeker
   ve en son "Tüketici Fiyat Endeksi - <Ay> <Yıl>" haberini bulur.
2. O haberin sayfasından, kurumun yayınladığı resmi arşiv Excel dosyasının
   (`TUFE_ARSIV_YUZDE_<AY>_<YIL>_WEB.xls` — 1977'den bugüne tüm aylık, yıl
   başından bu yana ve yıllık değişim oranlarını içerir) linkini bulur ve indirir.
3. Bu dosyayı ayrıştırıp `docs/data/tufe.json` dosyasını komple yeniden üretir
   (arşiv dosyası zaten tüm tarihçeyi içerdiği için "tek doğru kaynak" olarak
   kullanılır, kısmi güncelleme/birleştirme yapılmaz).
4. `.github/workflows/update.yml` bu betiği ayın ilk 10 günü her gün saat
   09:00 UTC'de (ve manuel tetiklemede) çalıştırır; veri değiştiyse commit'ler
   ve GitHub Pages'i yeniden yayınlar.
5. `docs/index.html` + `docs/app.js`, `docs/data/tufe.json`'ı okuyarak aylık
   değişim, yıllık (12 aylık) enflasyon, yıl başından bu yana kümülatif
   değişim ve Ocak–Haziran / Temmuz–Aralık dönem kümülatiflerini (maaş/ücret
   endekslemesinde kullanılan dönemler) gösterir.

## Kurulum (bir kere)

```bash
npm install
```

Yerelde manuel güncelleme denemek için:

```bash
npm run update
```

## GitHub'a bağlama

1. Bu klasörü yeni bir GitHub reposuna push edin.
2. Repo ayarlarında **Settings → Pages → Build and deployment → Source**
   kısmını **GitHub Actions** olarak seçin (bu bir kerelik ayar; workflow
   dosyası zaten `actions/deploy-pages` kullanıyor).
3. İlk workflow çalıştığında (push sonrası otomatik, ya da Actions sekmesinden
   `workflow_dispatch` ile manuel tetikleyerek) site yayına girer.

## Veri notu

Temmuz–Aralık dönem kümülatifi resmi bültenlerde doğrudan yayınlanmadığı için
Temmuz–Aralık aylarının "bir önceki aya göre" oranları zincirleme (bileşik)
olarak hesaplanır: `(1+a₇/100)×...×(1+a₁₂/100) - 1`. Ocak–Haziran dönemi ise
doğrudan Haziran ayının "bir önceki Aralık ayına göre" resmi değeridir.
