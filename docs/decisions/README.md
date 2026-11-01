# Kararlar

Projenin teknoloji, mimari, ortak sözleşme, oyun kuralı, donanım ve süreç kararları.
Proposal'larla aynı kural geçerli: **her sürüm kendi klasöründe**, main'e girmiş bir sürüm klasörü değiştirilmez.

| Sürüm | Tarih | Durum |
| --- | --- | --- |
| [v0.1](v0.1/) | 1 Kasım 2026 | 50 karar için öneriler; henüz hiçbiri verilmedi |

## Sürümler

| Sürüm | Anlamı |
| --- | --- |
| `v0.x` | Öneriler ve tartışma; kararlar henüz kesinleşmedi |
| `v1.0` | İlk karar toplantısının sonucu: en az 12 bloklayıcı karar "Karar verildi" |
| `v1.1`, `v1.2`, … | Yeni kararlar verildikçe veya açık kalanlar kapandıkça |
| `v2.0`, … | Önceden verilmiş bir karar değiştiğinde (etkilenen modüllerin onayıyla) |

## Karar verince

1. Son sürüm klasörünü yeni numarayla kopyalayın (örneğin `v0.1` → `v1.0`).
2. Yeni klasördeki `decision-list.md` dosyasında Durum sütununu güncelleyin; PDF'i de yenileyin.
3. Kararın sonucunu ilgili yere işleyin: ortak formatlar `contracts/`, modül detayları o modülün README'si veya proposal'ı.
4. `CHANGELOG.md` dosyasına hangi kararların verildiğini ve kimin onayladığını yazın; yukarıdaki tabloyu güncelleyin.

Kararlar toplantıda Claude Docs'taki paylaşılan listede de işaretlenebilir; repoya o listenin dışa aktarılmış hali konur.
