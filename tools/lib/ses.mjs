// "Seslendirme" ölçümü: pak dizininden ses varlıklarını bulup sınıflar. YALNIZCA OKUR (pak dizini + uasset ad tablosu;
// ses verisinin kendisi açılmaz). Sayılar belgeye yazılmaz; tools/oyun-haritasi.mjs her koşumda buradan basar.
//
// Bu ölçüm şunu GÖREMEZ: sesin hangi dilde olduğunu (dinlenmedi; yolda dil klasörü olmaması yalnızca "tek set" der) ·
// bir ses dosyasının hangi metin satırına bağlandığını (bu kod/Blueprint'te) · ubulk'un ses mi doku mu olduğunu ·
// ihracat (export) tablosunu çözmediği için "kendisi SoundWave mi" ayrımı ad tablosundaki `Default__SoundWave` adına
// dayanır (sınıfın varsayılan nesnesi; gerçek ses varlığında bulunur, yalnızca atıf edende bulunmaz: gözlem, belge değil) ·
// bir sesin oyunda gerçekten çalınıp çalınmadığını · ses verisinin biçimini (Ogg adı ad tablosundan okunur, bayt açılmaz).
import { tamYol } from './atif.mjs';
import { adTablosu } from './uexp-metin.mjs';

export const KOK = 'ModernStoryteller01/Content/';
export const KONUSMA_KLASORU = '0Game/Dialogue/';

/**
 * Varlığın ses bakımından türü, ad tablosundan (string[]):
 *   'ses'  = kendisi SoundWave (ad tablosunda Default__SoundWave var)
 *   'atif' = SoundWave'e yalnızca atıf ediyor (animasyon, SoundCue …), kendisi ses değil
 *   null   = sesle ilgisiz
 * `/Script/Engine` koşulu: SoundWave adı motorun kendi paketinden gelmeli (aynı adlı başka bir şey sayılmasın).
 */
export function sesTuru(adlar) {
  if (!adlar.includes('SoundWave') || !adlar.includes('/Script/Engine')) return null;
  return adlar.includes('Default__SoundWave') ? 'ses' : 'atif';
}

/** rel yolunda (kökte ya da altta) bir dil klasörü var mı? Taslaktaki ifade yolun BAŞINDAKİ klasörü kaçırıyordu. */
export function dilKlasoruVar(rel) {
  return /(^|\/)(en|de|es|fr|ja|ko|ru|zh|tr|en-US|ENG|English|German|Turkish)\//i.test(rel);
}

/**
 * hepsi: [{ pk, g }] (bütün paketlerin girişleri) · adOku: ad tablosu okuyucusu (varsayılan adTablosu; sınamada sahte verilir).
 * Aynı yol birden çok pakette varsa SONRAKİ paket geçerlidir (motor da öyle yükler); tekrar sayılmaz.
 * Döner: { toplamBoyut, tekrar (birden çok pakette geçen yol sayısı), incelenen, okunamayan[], gercek[], atif[], konusma, ogg, kanalli, boyut (gerçek seslerin uexp+ubulk),
 *   ubulkLu, atifTuru { anim, cue, oteki }, klasor (Map klasör→[adet, bayt]), dilli, ornek[] }.
 */
export function sesOlc(hepsi, adOku = adTablosu) {
  const giris = new Map();
  for (const { pk, g } of hepsi) giris.set(tamYol(pk, g), { pk, g });
  const toplamBoyut = [...giris.values()].reduce((t, e) => t + e.g.boyut, 0);
  const o = {
    toplamBoyut, tekrar: hepsi.length - giris.size, incelenen: 0, okunamayan: [], gercek: [], atif: [], konusma: 0, ogg: 0, kanalli: 0, boyut: 0, ubulkLu: 0,
    atifTuru: { anim: 0, cue: 0, oteki: 0 }, klasor: new Map(), dilli: 0, ornek: [],
  };
  for (const [yol, e] of giris) {
    if (!yol.startsWith(KOK) || !yol.endsWith('.uasset')) continue;
    const u = e.pk.icerik(e.g);
    if (!u.includes('SoundWave')) continue;            // ucuz ön süzgeç: ad tablosunu yalnızca aday varlıkta çöz
    const rel = yol.slice(KOK.length, -'.uasset'.length);
    let adlar;
    try { adlar = adOku(u); } catch (x) { o.okunamayan.push({ rel, mesaj: x.message }); continue; }
    const tur = sesTuru(adlar);
    if (!tur) continue;
    o.incelenen++;
    if (tur === 'atif') {
      o.atif.push(rel);
      if (adlar.includes('AnimSequence')) o.atifTuru.anim++;
      else if (adlar.includes('SoundCue')) o.atifTuru.cue++;
      else o.atifTuru.oteki++;
      continue;
    }
    const ue = giris.get(yol.replace(/\.uasset$/, '.uexp')), ub = giris.get(yol.replace(/\.uasset$/, '.ubulk'));
    const boyut = (ue?.g.boyut ?? 0) + (ub?.g.boyut ?? 0);
    o.gercek.push(rel);
    o.boyut += boyut;
    if (ub) o.ubulkLu++;
    if (rel.startsWith(KONUSMA_KLASORU)) o.konusma++;
    if (adlar.some(a => /^OGG/.test(a))) o.ogg++;
    if (adlar.includes('NumChannels') && adlar.includes('SampleRate')) o.kanalli++;
    if (dilKlasoruVar(rel)) o.dilli++;
    const kl = rel.split('/').slice(0, 3).join('/');
    const x = o.klasor.get(kl) ?? o.klasor.set(kl, [0, 0]).get(kl);
    x[0]++; x[1] += boyut;
  }
  const adim = Math.max(1, Math.floor(o.gercek.length / 8));
  o.ornek = o.gercek.filter((_, i) => i % adim === 0).slice(0, 8);
  return o;
}
