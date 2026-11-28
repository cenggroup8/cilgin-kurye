// M6-5 demo without keys: both emulators run against each other for about 20 s and the
// demo prints what goes in and out of each side. Used by the module demo page.
//   npm run demo
//
// Steps: connect → state, config, status and delay flow → a hand hit in zone 4 →
// a vibrate command → 30 % loss both ways → Wi-Fi off and on again.
// At the end every check is printed with ✓ or ✗; the exit code is 0 only if all pass.

import { BoardEmulator } from "./board/boardEmulator.js";
import { ServerEmulator } from "./server/serverEmulator.js";

const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
async function until(ok: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) return false;
    await wait(20);
  }
  return true;
}
const say = (s: string) => console.log(s);
const checks: [boolean, string][] = [];
const check = (ok: boolean, what: string) => {
  checks.push([ok, what]);
  say(`  ${ok ? "✓" : "✗"} ${what}`);
};

const server = new ServerEmulator({ port: 0, host: "127.0.0.1", seed: 7, scenario: { lobbyS: 1, countdownS: 1 } });
const port = await server.start();
const board = new BoardEmulator({ host: "127.0.0.1", port, seed: 7 });
await board.start();

say("M6-5 emülatörleri: sunucu emülatörü (M2'nin yerine) ↔ tahta emülatörü (gerçek tahtanın yerine)");
say(`Sunucu emülatörü 127.0.0.1:${port} portunda, tahta emülatörü onu arıyor.\n`);

say("1) Bağlanma (tahta → sunucu: Hello; sunucu → tahta: Config)");
check(await until(() => board.connected && server.metrics().connected, 5000), "tahta sunucuyu buldu ve bağlandı");
check(board.config?.plan === server.plan.version, `config geldi: parlaklık ${Number(board.config?.bright).toFixed(2)}, güç sınırı ${board.config?.max_ma} mA, plan ${board.config?.plan}`);

say("\n2) Sürekli akan mesajlar (3 s)");
await wait(3000);
const st = board.latestState?.d as { ph: number; p: unknown[]; dp: unknown[]; ob: unknown[] } | undefined;
check(board.stats.statesReceived > 50, `sunucu → tahta S (oyun durumu): ${board.stats.statesReceived} mesaj; son durum: aşama ${st?.ph}, ${st?.p.length} oyuncu, ${st?.dp.length} teslimat noktası, ${st?.ob.length} engel`);
check(server.metrics().delayMs !== null, `sunucu → tahta P / tahta → sunucu O (gecikme ölçümü): ${server.metrics().delayMs} ms`);
check(server.sensorMessages > 20, `tahta → sunucu N (sensör örnekleri): ${server.sensorMessages} mesaj, ${server.seismic.length} örnek`);
check(server.statusMessages >= 2, `tahta → sunucu T (durum raporu): fps ${server.lastStatus?.fps}, Wi-Fi ${server.lastStatus?.rssi} dBm, güç ${server.lastStatus?.ma_est} mA, hata ${JSON.stringify(server.lastStatus?.err)}`);

say("\n3) Tahtaya elle vuruş: bölge 4 (orta), güç 6 (tahta → sunucu: Q, sunucu → tahta: A)");
board.hit(4, 6);
check(await until(() => server.quakes.length === 1 && board.stats.quakesAnswered === 1, 3000), "sunucu deprem olayını bir kez aldı ve cevapladı");
const q = server.quakes[0];
if (q) say(`     olay: kaynak ${q.src}, güç ${q.mag.toFixed(1)}, bölge ${q.zone}, merkez (${q.u.toFixed(2)}, ${q.v.toFixed(2)}), güven ${q.conf.toFixed(2)}, tepe ${q.peak_g.toFixed(2)} g`);
const eq = server.scenario.boardState().eq as number[];
check(eq[0] === 1, "sunucu depremi oyuna aldı, tahtaya giden durumda şok dalgası var (eq)");

say("\n4) Titreşim komutu: sol üst ve sol alt motor (sunucu → tahta: V)");
server.vibrate(0b0101, 0.8, 800, 150);
check(await until(() => board.stats.vibrates === 1, 2000), "tahta titreşim komutunu aldı");
await wait(100);
check(board.motorPower()[0] > 0 && board.motorPower()[1] === 0, `motor gücü (yumuşak başlangıç): ${board.motorPower().map((p) => p.toFixed(2)).join(" / ")}`);
check(await until(() => server.quakes.length === 2, 2000), `motor sarsıntısı tek bir "motor" olayı verdi (bölge ${server.quakes[1]?.zone})`);

say("\n5) İki yönde %30 paket kaybı (3 s)");
server.setNet("down", { lossPct: 30 });
server.setNet("up", { lossPct: 30 });
const before = board.stats.statesReceived;
await wait(3000);
check(board.connected && server.metrics().connected, `bağlantı kopmadı; bu sürede ${board.stats.statesReceived - before} durum geldi, ölçülen kayıp %${server.metrics().lossPct.toFixed(1)}`);
board.hit(1, 5);
check(await until(() => server.quakes.length === 3, 3000), "kayıp varken de deprem olayı (TCP) ulaştı");
server.setNet("down", { lossPct: 0 });
server.setNet("up", { lossPct: 0 });

say("\n6) Wi-Fi kesilir ve geri gelir");
server.vibrate(15, 1, 5000, 0);
await until(() => board.motorPower()[0] > 0, 1000);
board.setWifi(false);
check(board.linkState === "searching" && board.motorPower().every((p) => p === 0), "tahta hemen 'arıyor' durumuna geçti, motorlar durdu");
check(await until(() => !server.metrics().connected, 5000), "sunucu tahtanın koptuğunu gördü");
board.setWifi(true);
check(await until(() => board.connected && server.metrics().connected, 6000), "Wi-Fi gelince tahta kendisi yeniden bağlandı");

await board.close();
await server.close();
const failed = checks.filter(([ok]) => !ok).length;
say(`\nSonuç: ${checks.length - failed}/${checks.length} kontrol geçti.`);
process.exit(failed === 0 ? 0 : 1);
