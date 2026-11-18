# The Forgotten City – Türkçe Yama

The Forgotten City (Steam, 874260) için Türkçe çeviri ve yerelleştirme yaması.
Menüler, konuşmalar, görev ve eşya metinleri Türkçe olur; başlıklardaki `İ`
harfi de doğru çizilir.

## Kurulum (oyuncular için)

1. Sürümler sayfasından yükleyici zip dosyasını indirin ve Program Files dışında
   bir klasöre çıkarın.
2. Oyun kapalıyken `Yukle.exe`yi çalıştırın.
3. Steam'deki oyun otomatik bulunur. Bulunamazsa "Oyun klasörünü seç…" ile
   oyunun klasörünü gösterin (içinde `ModernStoryteller01` klasörü olan klasör).
4. "Yamayı kur"a basın.
5. Oyunda Ayarlar > Arayüz > Dil satırından "Türkçe"yi seçin.

Kaldırmak için `Yukle.exe` > "Yamayı kaldır".

## Güvenlik

- Oyun dosyalarını değiştirmez; `Content/Paks` klasörüne yalnızca
  `pakchunk0-WindowsNoEditor_P.pak` adlı tek dosya ekler. O dosya silinirse oyun
  eski hâline döner.
- İnternete bağlanmaz, kayıtlarınıza ve ayarlarınıza dokunmaz.
- Oyun açıkken kurmaz; oyun sürümü sınananla aynı değilse hiçbir şey kurmaz.
- Yama paketi sizin bilgisayarınızda, sizin oyun dosyalarınızdan üretilir.
  Bu depoda ve yükleyici paketinde oyundan türeyen dosya yoktur.
- Program imzasızdır; Windows SmartScreen uyarı verebilir. Kaynak kod bu depoda.

## Denenen sürüm

Yalnızca Windows 10, Steam sürümü, yapı numarası 9300715. Epic, GOG ve başka
sürümler denenmedi.

## Depodaki dizin

| yol | içerik |
|---|---|
| `ceviri/` | Türkçe çeviri parçaları (`parca-NN.json`), oyun sürüm parmak izi |
| `tools/` | yama üreten ve kuran Node betikleri |
| `yukleyici/` | pencere (C# WinForms) ve paketleme |

Paket üretmek için: `node tools/yukleyici-paketle.mjs` (çıktı `dist/`).
Betikler oyunun kendi dosyalarına hiç yazmaz.

## Lisans

Araçlar ve yükleyici: MIT (`LICENSE`). Türkçe çeviri: CC BY-NC 4.0
(`LICENSE-CEVIRI`). Oyun ve oyunun metni yapımcılarına aittir.
