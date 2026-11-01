# Çılgın Kurye — Karar Listesi

Nov 1, 2026 · @Taha

Diğer modüllerin proposal'ları birbirine ve M4, M7, M8'e uysun diye önce 50 karar verilmeli. Bunların 12'si **bloklayıcı**: verilmeden M1, M2, M3, M5 ve M6 proposal'ları girdi ve çıktılarını yazamaz. Her satırda bir öneri, alternatifler ve hangi modülleri etkilediği var. Toplantıda öneriyi kabul ederseniz Durum'u "Karar verildi" yapın.

## Nasıl kullanılır

1. **Önce bloklayıcıları kapatın** (aşağıdaki liste). Hepsi tek bir toplantıda verilebilir; çoğunun önerisi M4, M7 ve M8 proposal'larında zaten gerekçelendirildi.
2. **Kararı veren:** etkilenen modüllerin her birinden en az bir kişinin onayı. Tüm grup gerekmez.
3. **Karar verilince** sonucu repoda `contracts/` klasörüne veya ilgili README'ye işleyin; bu doküman sadece takip listesi.
4. **Sonradan değişirse** kural proposal'larla aynı: girdi veya çıktıyı değiştiren karar, etkilenen modüllerin onayı ve `contracts/` güncellemesiyle birlikte değişir.

### Bloklayıcı kararlar (proposal yazımından önce)

| # | Karar | Öneri | Etkilediği |
| --- | --- | --- | --- |
| A1 | Sunucu dili | TypeScript + Node.js 24 LTS | M1, M2, M3, M4, M6 |
| A3 | Sunucu tick hızı | 30 Hz | M1–M5 |
| A4 | Yetki ve tahmin modeli | Sunucu yetkili, telefonda kendi motoru için tahmin | M2, M3, M5 |
| A5 | Fizik telefonda da çalışacak mı | Evet, aynı TypeScript kodu | M3, M5 |
| B1 | Telefon bağlantısı | Düz WebSocket | M2, M5, M6 |
| B2 | Telefon mesaj kodlaması | MessagePack | M2, M5, M6 |
| B3 | Telefona giden durum mesajı | Tam durum, 30 Hz | M1, M2, M5 |
| B5 | Admin paneli teknolojisi | Sunucunun sunduğu web sayfası | M2, M6 |
| C1 | Dünya boyutu ve koordinatlar | 500 m, 100 m aralık, x doğu, z güney | M1, M3, M4, M5, M8 |
| C3 | Kontrol mesajı | `throttle`, `brake`, `steer`, `deliver` | M2, M3, M4, M5 |
| C5 | Engel modeli | 4 tip, yol segmenti + şerit + konum | M1, M3, M4, M6, M8 |
| G1 | Proposal şablonu | M4/M7/M8 ile aynı bölüm başlıkları | Tümü |

## A. Sistem mimarisi

Bu gruptaki kararlar diğer her şeyi belirler; özellikle A1 verilmeden M1, M2, M3 ve M6 teknoloji bölümünü yazamaz.

| # | Karar | Öneri | Alternatifler | Etkilediği | Durum |
| --- | --- | --- | --- | --- | --- |
| A1 | Sunucu dili ve sürümü | TypeScript, Node.js 24 LTS. Telefon istemcisiyle (Three.js) aynı dil; tipler ve fizik kodu paylaşılır | Node.js 26 LTS (daha yeni); Python 3.12; C# / .NET | M1, M2, M3, M4, M6 | Öneri var |
| A2 | Süreç yapısı | Tek Node süreci. M1'in tick döngüsü M3 ve M4'ü fonksiyon olarak çağırır; fizik yavaşlarsa M3 bir worker thread'e taşınır | Her modül ayrı süreç, aralarında yerel soket | M1, M3, M4 | Öneri var |
| A3 | Sunucu tick hızı | 30 Hz oyun tick'i; M3 her tick'te 2 alt adım çalıştırır (fizik 60 Hz) | 20 Hz (daha az ağ, daha kaba hareket); 60 Hz (iki kat ağ ve CPU) | M1, M2, M3, M4, M5 | Öneri var |
| A4 | Yetki ve tahmin modeli | Sunucu her kararı verir. Telefon kendi motorunu anında tahmin eder, sunucu cevabıyla düzeltir; diğer oyuncuları 100 ms geriden ara değerlerle çizer | Saf sunucu (telefonda gecikme hissedilir); istemci yetkili (oyuncular arası tutarsızlık) | M2, M3, M5 | Öneri var |
| A5 | Fizik kodu telefonda da çalışacak mı | Evet. M3 fiziği tarayıcı ve Node'da çalışan saf bir TypeScript paketi; tahmin için telefon aynı kodu kullanır | Telefonda ayrı, basit bir tahmin kodu (iki kod zamanla ayrışır) | M3, M5 | Öneri var |
| A6 | Repo ve paket yapısı | npm workspaces; ortak paket `@ck/contracts` tüm mesaj tiplerini ve doğrulama şemalarını (zod) içerir | pnpm workspaces; her klasör ayrı proje | Tüm yazılım modülleri | Öneri var |
| A7 | Kayıt ve tekrar oynatma | Her tick'in girdisi JSON Lines dosyasına yazılır; hata çıkan oyun tek modülde tekrar oynatılabilir | Sadece hata logu | M1, M2, M3, M4, M6 | Öneri var |

A1 ve A5 birbirine bağlı: sunucu TypeScript değilse fizik kodu telefonda paylaşılamaz ve A4'teki tahmin için M5'in fiziği ayrıca yazması gerekir.

## B. Ağ ve mesajlar

Board bağlantısı M7'de belirlendi (UDP + MessagePack, 30 Hz). Bu grup telefon ve admin bağlantılarını belirler; M2, M5 ve M6 proposal'ları doğrudan bunlara dayanır.

| # | Karar | Öneri | Alternatifler | Etkilediği | Durum |
| --- | --- | --- | --- | --- | --- |
| B1 | Telefon bağlantısı | Düz WebSocket (sunucuda `ws` kütüphanesi), tek bağlantı | Socket.IO (yeniden bağlanma hazır ama ek katman ve ek gecikme); WebRTC DataChannel (UDP gibi ama kurulumu zor) | M2, M5, M6 | Öneri var |
| B2 | Telefon mesaj kodlaması | MessagePack; geliştirme modunda JSON seçilebilir | Sadece JSON (okunur ama 2–3 kat büyük) | M2, M5, M6 | Öneri var |
| B3 | Telefona giden durum mesajı | Her tick tam durum: 8 oyuncu, NPC'ler, engeller, teslimat noktaları, süre ve skor; sıra numaralı. Hedef boyut 4 KB'ın altında | Sadece değişenleri göndermek (küçük ama paket kaybında karmaşık); 20 Hz | M1, M2, M5 | Öneri var |
| B4 | Kontrol gönderim sıklığı | Bir tuş değişince hemen, değişmese de en az 10 Hz | Sabit 30 Hz | M2, M5 | Öneri var |
| B5 | Admin paneli teknolojisi | Sunucunun sunduğu web sayfası, aynı TypeScript; canlı grafikler için uPlot | Electron masaüstü uygulaması; Python ile ayrı panel | M2, M6 | Öneri var |
| B6 | Admin ↔ sunucu protokolü | Aynı WebSocket sunucusu, "admin" rolü ve basit parola | Ayrı REST API (canlı grafikler için yine WebSocket gerekir) | M2, M6 | Öneri var |
| B7 | Admin gecikme / kayıp / FPS ayarları nerede uygulanır | Gecikme ve kayıp M2'de, sunucuda her oyuncu için ayrı kuyrukla; FPS sınırı telefonda M5'te; board bağlantısı için de M2 | İşletim sistemi seviyesinde (Linux `tc netem`; Windows'ta yok) | M2, M5, M6, M7 | Öneri var |
| B8 | Saat ve gecikme ölçümü | Sunucu oyun zamanı (ms); 500 ms'de bir ping, telefon saat farkını hesaplar | Ayrı bir saat eşitleme protokolü | M2, M5, M6, M7 | Öneri var |
| B9 | Bağlantı kopunca | Oyuncu anahtarı tarayıcıda saklanır; 30 s içinde dönerse aynı motora oturur, dönmezse bot devralır | Oyuncu oyundan düşer | M1, M2, M4, M5 | Öneri var |
| B10 | HTTP mi HTTPS mi | Yerel ağda HTTP. Ekranın kapanmasını engelleme (Wake Lock) gibi bazı tarayıcı özellikleri HTTPS ister; gerekirse kendinden imzalı sertifika denenir | Baştan HTTPS (her telefonda sertifika uyarısı) | M2, M5 | Öneri var |

## C. Ortak sözleşmeler

Bu kararların taslağı repoda `contracts/` klasöründe duruyor (`city_plan.json` sürüm 0.1.0, `messages.md`). Onaylanınca şehir planı 1.0.0 olur ve bundan sonra her değişiklik etkilenen modüllerin onayını ister.

| # | Karar | Öneri | Alternatifler | Etkilediği | Durum |
| --- | --- | --- | --- | --- | --- |
| C1 | Dünya boyutu ve koordinatlar | 500 × 500 m, yollar arası 100 m; orijin kuzeybatı köşe kavşağı, x doğu, z güney, y yukarı; yön kuzeyden saat yönünde derece. Board için u = x / 500, v = z / 500 | Daha küçük dünya (örneğin 300 m: daha kısa sürüşler, daha sık teslimat) | M1, M3, M4, M5, M8 | Öneri var |
| C2 | Yol ve şerit yapısı | Her yönde 2 şerit, şerit genişliği 3,5 m, sağdan trafik | Her yönde 1 şerit ("kaza bir şeridi kapatır" kuralı anlamını yitirir) | M3, M4, M5, M8 | Öneri var |
| C3 | Kontrol mesajı | `throttle` ve `brake` 0–1, `steer` −1 ile 1 arası, `deliver` true/false; sıra numaralı. Botlar da aynı mesajı gönderir | Ayrı "tuşa basıldı / bırakıldı" olayları | M2, M3, M4, M5 | Öneri var |
| C4 | Kimlikler ve renkler | Oyuncu 0–7, takım 0–3 (0 mavi kuzeybatı, 1 yeşil kuzeydoğu, 2 mor güneybatı, 3 sarı güneydoğu), ton 0 açık / 1 koyu. 8 tonun RGB değerleri tek tabloda; son değerler M8'in renk kalibrasyonundan gelir | Tonları her modül kendisi seçer (3D ve board renkleri uyuşmaz) | Tümü | Öneri var |
| C5 | Engel modeli | 4 tip: `heavy_traffic`, `road_work`, `accident`, `puddle`. Yerleşim: yol segmenti (0–59) + şerit (0 = tüm yol) + segment üzerinde konum (0–1) | Engeli serbest x, z koordinatıyla vermek (board'da gösterilemez) | M1, M3, M4, M6, M8 | Öneri var |
| C6 | Deprem olayı | Kaynak: elle vurma, motor veya admin butonu. M7 ölçülen büyüklüğü (0–10) ve merkezi gönderir; M1 bunu admin katsayısıyla çarpar, hangi yolların kapanacağını ve kimin düşeceğini M1 seçer | Etkileri M3 kendisi hesaplar | M1, M3, M6, M7, M8 | Öneri var |
| C7 | Binalar şehir planında mı | Evet: her bloğun bina ayak izleri ve yükseklikleri `city_plan.json`'a eklenir. M3 çarpışma, M5 3D çizim, M8 baskı için aynı veriyi kullanır | Her modül binaları kendisi yerleştirir (3D şehir ile board farklılaşır) | M1, M3, M5, M8 | Açık |

C7 henüz hiçbir proposal'da yok; proje proposal'ı "3D şehir ve board aynı plandan yapılır" dediği için gerekli. Kabul edilirse şehir planına `buildings` alanı eklenir.

## D. Oyun kuralları

Kuralların sahibi M1, ama M3, M4, M5 ve M6 bu kuralların girdi ve çıktılarını kullanıyor. Sayılar başlangıç değerleri; çoğu admin parametresi olduğu için sonradan ayarlanır, ama alanın kendisi sabitlenmeli.

| # | Karar | Öneri | Alternatifler | Etkilediği | Durum |
| --- | --- | --- | --- | --- | --- |
| D1 | Paket alma ve teslim | Mağaza alanına (10 m) girince paket otomatik alınır. Teslim: nokta yarıçapı (6 m) içinde ve hız 3 m/s'nin altındayken "Teslim et" butonu | Teslim de otomatik (telefondaki buton anlamını yitirir) | M1, M4, M5 | Öneri var |
| D2 | Puanlama | Teslimat başına sabit puan + tahmini süreye göre uzaklık bonusu; formül M1 proposal'ında. Admin yakın nokta verdiğinde oyuncu haksız avantaj kazanmasın diye | Her teslimat 1 puan (proje proposal'ındaki en basit okuma) | M1, M4, M6 | Açık |
| D3 | Teslimat noktası seçimi | Aday noktalar şehir planında; M4 her takım için süre tablosunu verir; M1 admin'in yakın/uzak olasılığına göre seçer | M4 noktayı kendisi seçer | M1, M4, M6 | Öneri var |
| D4 | Düşme ve ceza | Düşüp düşmeyeceğine M3 karar verir (hız eşiği admin parametresi); ceza süresi admin parametresi, başlangıç 3 s; düşünce paket kaybolmaz | Düşünce paket kaybolur ve mağazaya dönmek gerekir | M1, M3, M5, M6 | Öneri var |
| D5 | Oyuncu–oyuncu çarpışması | Bağıl hız eşiğin üstündeyse ikisi de düşer, altındaysa birbirini iter | Hiç çarpışma yok (motorlar birbirinin içinden geçer) | M1, M3 | Öneri var |
| D6 | Botlar | Boş yerleri bot doldurur; admin bot sayısını ve `bot.skill` zorluğunu ayarlar; botlar telefonla aynı kontrol mesajını gönderir (M4 v0.1) | Bot yok, eksik takım eksik oynar | M1, M4, M6 | Öneri var |
| D7 | Oyun akışı | Lobi (takım seçimi) → 3 s geri sayım → en fazla 5 dk oyun → bitiş ekranı; admin duraklatabilir. Bu 5 faz board mesajındaki `ph` alanıyla aynı | Lobisiz, QR okutan oyuna doğrudan girer | M1, M2, M5, M6, M8 | Öneri var |
| D8 | "Beni bul" butonu | Board'da 1 s beyaz yanıp sönme; aynı oyuncu için 5 s bekleme süresi | Bekleme süresi yok (board sürekli yanıp sönebilir) | M1, M5, M8 | Öneri var |
| D9 | Admin grafikleri için ölçümler kimde | Her modül kendi ölçümünü üretir (skor ve teslimat süresi M1, rota değişikliği M4, ping ve kayıp M2, board gecikmesi M7); M1 bunları tek bir `metrics` mesajında 2 Hz ile M6'ya yollar | M6 her şeyi ham durumdan kendisi hesaplar | M1, M2, M4, M6, M7 | Öneri var |

## E. İstemci, fizik ve 3D

Bu grup M3 ve M5'in içini belirler; M8 de binaları aynı modellerden bastığı için E3'e bağlı.

| # | Karar | Öneri | Alternatifler | Etkilediği | Durum |
| --- | --- | --- | --- | --- | --- |
| E1 | Fizik motoru | Kendi 2D arcade fiziğimiz: motor için bisiklet modeli, binalar ve araçlar için kutu çarpışmaları, yükseklik yok. Küçük, deterministik ve telefonda da çalışır (A5) | Rapier (WebAssembly, güçlü ama ayarı zor); cannon-es (3D, bu oyun için fazla) | M3, M5 | Öneri var |
| E2 | 3D kütüphanesi ve paketleme | Three.js (proje proposal'ında yazıyor), sürümü sabitlenir; Vite ile paketleme | Babylon.js; PlayCanvas | M5 | Öneri var |
| E3 | Model hazırlama | Low-poly modeller Blender'da tek kaynaktan: glTF olarak 3D şehre, STL olarak board baskısına. Ölçek: oyunda 1 m = board'da 1 mm | Hazır model paketleri (lisans sorunu, board ile uyuşmaz) | M5, M8 | Öneri var |
| E4 | Katılım akışı | QR kod sunucunun yerel adresini açar; telefon sadece tarayıcı kullanır; lobide takım seçilir; ilk 8 kişi oyuncu olur | Uygulama yükleme (proje proposal'ına aykırı) | M1, M2, M5, M6 | Öneri var |
| E5 | Desteklenen telefonlar | Android Chrome ve iOS Safari'nin son iki sürümü; yatay ekran; orta seviye telefonda hedef 30 fps | Sadece Android | M5 | Öneri var |
| E6 | Kamera | Motorun arkasından üçüncü şahıs; depremde kamera sarsıntısı | Kuşbakışı (haritanın yerini tutar, oyunun fikrine aykırı) | M5 | Öneri var |

## F. Donanım, bütçe ve demo ortamı

Parça seçimleri M7 ve M8 proposal'larında; burada grubun ortak vereceği kararlar var. F1 ve F2 için öneri yok, çünkü grubun imkanlarına bağlı.

| # | Karar | Öneri | Alternatifler | Etkilediği | Durum |
| --- | --- | --- | --- | --- | --- |
| F1 | Bütçe ve satın alma sorumlusu | M7 ve M8 parça listelerinin fiyatlandırılması, kimin sipariş vereceği ve masrafın nasıl paylaşılacağı | Bölümün laboratuvar malzemesi kullanılabiliyorsa onunla başlamak | M7, M8 | Açık |
| F2 | Ana bilgisayar | Demo ve testler için grupta tek, sabit bir laptop; işletim sistemi seçilir. Node.js Windows ve Linux'ta aynı çalışır | Herkes kendi bilgisayarında geliştirir, demo bilgisayarı son haftada belirlenir (son dakika sürprizi riski) | M1, M2, M6 | Açık |
| F3 | Wi-Fi ağı | Oyuna ayrılmış, internete bağlı olmayan bir router; sunucuya sabit IP; board 2,4 GHz'te (ESP32 5 GHz desteklemez), telefonlar 5 GHz'te olabilir | Okul Wi-Fi'ı (cihazlar birbirini görmeyebilir, gecikme kontrol edilemez) | M2, M5, M7 | Öneri var |
| F4 | Hareket sensörü | MPU-6050 ve LSM6DS3TR-C 1. haftada test edilir, iyi olan seçilir (M7 v0.1) | Tek sensörle başlamak | M7, M8 | Öneri var |
| F5 | 3D yazıcı ve lazer kesici erişimi | Bina baskıları yaklaşık 50 saat sürüyor; yazıcı 2. haftada belli olmalı | Daha az bina, daha basit modeller | M5, M8 | Açık |

## G. Süreç ve araçlar

Proposal'ların aynı şekilde yazılması ve kodun aynı kurallarla birleşmesi için. Repo yapısı ve versiyonlama kuralı zaten kuruldu (`docs/proposals/README.md`).

| # | Karar | Öneri | Alternatifler | Etkilediği | Durum |
| --- | --- | --- | --- | --- | --- |
| G1 | Proposal şablonu | İngilizce; M4, M7, M8 ile aynı bölümler: özet ve kapsam, sistemdeki yeri, arayüz (girdi/çıktı), veri formatları ve örnekler, teknoloji seçimleri ve alternatifler, nasıl çalışır, parametreler ve kalibrasyon, tek başına test, entegrasyon, riskler, iş planı ve açık kararlar. Repoya `.md` + `.pdf` | Her modül kendi formatında | M1, M2, M3, M5, M6 | Öneri var |
| G2 | Proposal tarihleri | Teslim tarihi ve ondan en az 1 hafta önce grup içi taslak (v0.1) tarihi; taslaklar çapraz okunur | — | Tümü | Açık |
| G3 | Kod kuralları | TypeScript `strict`, ESLint + Prettier; C++ için clang-format; her PR'ı başka modülden biri onaylar | Kural yok | Tüm yazılım | Öneri var |
| G4 | Test ve CI | TypeScript'te vitest, firmware'de PlatformIO testleri; her modülün mock'ları kendi klasöründe; testler her PR'da GitHub Actions'ta çalışır | Sadece elle test | Tüm yazılım | Öneri var |
| G5 | İş takibi | Tek GitHub Project panosu; proposal'lardaki her test ID'si (T1, S3, C4…) bir issue; haftalık kısa toplantı ve notu `docs/meetings/` altında | WhatsApp grubu ve kişisel listeler | Tümü | Öneri var |
| G6 | Sözleşme sahipleri | `city_plan.json` M1 (M8 inceler); board protokolü M7 (M2 inceler); telefon ve admin mesajları M2 (M5 ve M6 inceler) | Sahipsiz ortak dosyalar | Tümü | Öneri var |

## Kaynaklar

- [Node.js sürüm destek takvimi — endoflife.date](https://endoflife.date/nodejs): Node.js 24 20 Ekim 2026'dan beri bakım döneminde, güvenlik desteği 30 Nisan 2028'e kadar sürüyor; Node.js 26 aktif LTS. Proje ocakta biteceği için ikisi de yeterli; 24 daha uzun süredir kullanımda olduğu için önerildi.
- Modül proposal'ları (M4, M7, M8 v0.1) ve sözleşme taslağı: repoda `docs/proposals/` ve `contracts/`.
