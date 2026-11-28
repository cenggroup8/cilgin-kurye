// `net {fps_limit}` (contracts/messages.md, #90): M2-3 sends the frame rate limit of one phone,
// when the parameter changes and when the phone joins or comes back.
import { describe, expect, it } from "vitest";
import { attachBroadcast } from "../src/broadcast/broadcastHub.js";
import { FakeM1 } from "./fakes/fakeM1.js";

function setup() {
  let players = [{ connId: 10, playerNo: 0 }, { connId: 11, playerNo: 1 }];
  const sent: Array<{ connId: number; msg: any }> = [];
  const server = {
    registry: { playerConns: () => players, adminConn: null } as any,
    send: (connId: number, msg: unknown) => sent.push({ connId, msg }),
    sendRaw: () => {},
  };
  const hub = attachBroadcast({ server, timers: false });
  const nets = () => sent.filter((s) => s.msg?.t === "net");
  return { hub, nets, setPlayers: (p: typeof players) => (players = p) };
}

describe("M2-3 net fps_limit", () => {
  it("goes only to the phone of that player when the parameter changes", () => {
    const { hub, nets } = setup();
    expect(hub.netParam("net.1.fps_limit", 30)).toBe(true);
    expect(nets()).toEqual([{ connId: 11, msg: { t: "net", fps_limit: 30 } }]);
    hub.paramChanged("net.1.fps_limit", 30); // same value: nothing new
    expect(nets()).toHaveLength(1);
    hub.paramChanged("net.1.fps_limit", 0);
    expect(nets().at(-1)).toEqual({ connId: 11, msg: { t: "net", fps_limit: 0 } });
  });

  it("other parameters and values outside 0–120 are not sent", () => {
    const { hub, nets } = setup();
    expect(hub.netParam("physics.top_speed_mps", 5)).toBe(false);
    hub.netParam("net.0.fps_limit", 500);
    hub.netParam("net.0.fps_limit", 12.5);
    expect(nets()).toEqual([]);
  });

  it("the start values of the parameter list go out once; a joining or returning phone gets its limit with the next tick", () => {
    const { hub, nets, setPlayers } = setup();
    hub.params([{ name: "net.0.fps_limit", value: 0 }, { name: "net.2.fps_limit", value: 20 }]);
    expect(nets()).toEqual([{ connId: 10, msg: { t: "net", fps_limit: 0 } }]);
    const m1 = new FakeM1();
    hub.publish(m1.frame());
    expect(nets()).toHaveLength(1);
    // Player 2 joins, player 0 comes back on a new link.
    setPlayers([{ connId: 12, playerNo: 2 }, { connId: 20, playerNo: 0 }, { connId: 11, playerNo: 1 }]);
    hub.publish(m1.frame());
    expect(nets().slice(1)).toEqual([
      { connId: 12, msg: { t: "net", fps_limit: 20 } },
      { connId: 20, msg: { t: "net", fps_limit: 0 } },
    ]);
  });
});
