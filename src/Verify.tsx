// /verify: re-check any draw in your own browser. Nothing here trusts our server's answer:
// it rebuilds the entry-list hash, reads the commitment memo from Solana, fetches the drand beacon,
// and redoes the winner math, then compares each result with what the game recorded.
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "./lib/supabase";

type Fair = {
  id: number; kind: "round" | "vault"; ref: number; status: "frozen" | "committed" | "settled" | "no_entries";
  entries: { c: string; t: number }[]; total: number; hash: string; cluster: string | null; commit_tx: string | null;
  drand_chain: string | null; drand_round: number | null; randomness: string | null; winning_ticket: number | null;
  winner_code: string | null; result_tx: string | null; created_at: string; committed_at: string | null; settled_at: string | null;
  prize: string | null; winner_name: string | null;
};
type Recent = { id: number; kind: string; ref: number; status: string; total: number; created_at: string };
type Check = { state: "ok" | "bad" | "wait" | "info"; text: string };

const DRAND = { chain: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971", genesis: 1692803367, period: 3 };
const roundTime = (r: number) => DRAND.genesis + (r - 1) * DRAND.period;
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha = async (s: string | Uint8Array) => hex(await crypto.subtle.digest("SHA-256", typeof s === "string" ? enc.encode(s) : s));
const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));
const solRpc = (c: string | null) => (c === "mainnet-beta" ? "https://api.mainnet-beta.solana.com" : "https://api.devnet.solana.com");
const explorer = (tx: string, c: string | null) => `https://explorer.solana.com/tx/${tx}${c === "mainnet-beta" ? "" : "?cluster=devnet"}`;
const when = (unix: number) => new Date(unix * 1000).toLocaleString();

/** The same pick the database makes: SHA-256(randomness ":" hash) as a number, mod total, then walk the list. */
async function pickWinner(randomness: string, hash: string, entries: Fair["entries"], total: number) {
  const seed = await sha(`${randomness}:${hash}`);
  const ticket = BigInt("0x" + seed) % BigInt(total);
  let cum = 0n;
  for (const e of entries) { cum += BigInt(e.t); if (cum > ticket) return { seed, ticket, code: e.c }; }
  return { seed, ticket, code: null as string | null };
}

export default function Verify() {
  const q = new URLSearchParams(location.search);
  const id = Number(q.get("id")) || null;
  const season = Number(q.get("season")) || null;
  return (
    <div className="guide">
      <header className="guide-head">
        <a href="/" className="logo">Vault <span>Hunt</span></a>
        <a className="btn small" href="/guide">How to play</a>
      </header>
      <div className="guide-body">
        <h1>Draw proof</h1>
        <p className="sub">Every Vault Hunt raffle can be checked by anyone. This page redoes each step in your browser and compares it with what the game recorded.</p>
        {season ? <PassReveal season={season} /> : id ? <Proof id={id} /> : <RecentList />}
        <HowItWorks />
      </div>
    </div>
  );
}

function RecentList() {
  const [list, setList] = useState<Recent[] | null>(null);
  useEffect(() => { supabase.rpc("fair_draws_recent").then(({ data }) => setList((data as Recent[]) ?? [])); }, []);
  if (!list) return <p className="sub">Loading draws...</p>;
  if (!list.length) return <div className="guide-sec"><p className="sub">No draws yet. The first proof appears here as soon as a draw closes.</p></div>;
  return (
    <div className="guide-sec">
      <h2>Recent draws</h2>
      <div className="hist">
        {list.map((r) => (
          <div key={r.id}>
            <a href={`/verify?id=${r.id}`}>{r.kind === "round" ? `Daily round ${r.ref}` : `Vault Draw ${r.ref}`}</a>
            <span>{r.total.toLocaleString()} tickets · {r.status === "settled" ? "drawn" : r.status === "no_entries" ? "no entries" : "drawing"} · {new Date(r.created_at).toLocaleDateString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Proof({ id }: { id: number }) {
  const [f, setF] = useState<Fair | null | undefined>(undefined);
  const [mine, setMine] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const [math, setMath] = useState<{ seed: string; ticket: bigint; code: string | null } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    supabase.rpc("fair_draw_public", { p_id: id }).then(({ data }) => setF((data as Fair) ?? null));
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) supabase.rpc("fair_my_code", { p_id: id }).then(({ data: c }) => setMine((c as string) ?? null));
    });
  }, [id, tick]);
  // Keep refreshing while the draw is still in progress.
  useEffect(() => {
    if (!f || f.status === "settled" || f.status === "no_entries") return;
    const t = setTimeout(() => setTick((x) => x + 1), 5000);
    return () => clearTimeout(t);
  }, [f]);

  useEffect(() => {
    if (!f) return;
    const set = (k: string, c: Check) => setChecks((m) => ({ ...m, [k]: c }));
    (async () => {
      // 1. Entry list -> hash
      const txt = f.entries.map((e) => `${e.c}:${e.t}`).join("\n") + (f.entries.length ? "\n" : "");
      const h = await sha(txt);
      const sum = f.entries.reduce((s, e) => s + e.t, 0);
      set("list", h === f.hash && sum === f.total
        ? { state: "ok", text: `The ${f.entries.length} entries below add up to ${f.total.toLocaleString()} tickets and hash to ${h.slice(0, 16)}..., matching the commitment.` }
        : { state: "bad", text: "The entry list doesn't match the recorded hash." });

      // 2. Commitment on Solana
      if (!f.drand_round) set("chain", { state: "wait", text: "Waiting for the commitment to be posted." });
      else if (!f.commit_tx) set("chain", { state: "info", text: "This draw ran before the on-chain draw wallet was set up, so the commitment was recorded by the game only." });
      else {
        try {
          const r = await fetch(solRpc(f.cluster), { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [f.commit_tx, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }] }) });
          const tx = (await r.json())?.result;
          const memo: string = (tx?.transaction?.message?.instructions ?? []).map((i: { parsed?: unknown }) => (typeof i.parsed === "string" ? i.parsed : "")).join(" ");
          const okMemo = memo.includes(`entries=${f.hash}`) && memo.includes(`:${f.drand_round}`);
          const early = (tx?.blockTime ?? Infinity) < roundTime(f.drand_round);
          set("chain", okMemo && early
            ? { state: "ok", text: `Posted on Solana at ${when(tx.blockTime)}, before drand round ${f.drand_round} (${when(roundTime(f.drand_round))}). The memo names this exact hash and round.` }
            : { state: tx ? "bad" : "wait", text: tx ? (okMemo ? "The memo landed after the drand round was public." : "The Solana memo doesn't match this draw.") : "Couldn't read the Solana transaction right now. Use the explorer link." });
        } catch { set("chain", { state: "wait", text: "Couldn't reach Solana from your browser. Use the explorer link." }); }
      }

      // 3. drand beacon
      if (f.drand_round) {
        if (Date.now() / 1000 < roundTime(f.drand_round)) set("drand", { state: "wait", text: `Round ${f.drand_round} is published at ${when(roundTime(f.drand_round))}. Nobody knows its value yet.` });
        else {
          try {
            const b = await (await fetch(`https://api.drand.sh/${DRAND.chain}/public/${f.drand_round}`)).json();
            const fromSig = await sha(unhex(b.signature));
            const ok = fromSig === b.randomness && (!f.randomness || f.randomness === b.randomness);
            set("drand", ok
              ? { state: "ok", text: `drand round ${f.drand_round} randomness is ${String(b.randomness).slice(0, 16)}..., which is the SHA-256 of its signature${f.randomness ? " and matches what the game used" : ""}.` }
              : { state: "bad", text: "The drand beacon doesn't match what the game used." });
          } catch { set("drand", { state: "wait", text: "Couldn't reach drand from your browser. Use the drand link." }); }
        }
      }

      // 4. Winner math
      if (f.randomness && f.total > 0) {
        const m = await pickWinner(f.randomness, f.hash, f.entries, f.total);
        setMath(m);
        set("math", m.code === f.winner_code && String(m.ticket) === String(f.winning_ticket)
          ? { state: "ok", text: `Winning ticket ${m.ticket.toLocaleString()} of ${f.total.toLocaleString()} belongs to ${m.code}. Same as the game's result.` }
          : { state: "bad", text: "Recomputing the winner gives a different result." });
      }
    })();
  }, [f]);

  if (f === undefined) return <p className="sub">Loading draw {id}...</p>;
  if (f === null) return <div className="guide-sec"><p className="sub">No draw with that number. <a href="/verify">See recent draws</a>.</p></div>;

  const title = f.kind === "round" ? `Daily round ${f.ref}` : `Vault Draw ${f.ref}`;
  const Step = ({ k, n, label, children }: { k: string; n: number; label: string; children?: ReactNode }) => {
    const c = checks[k];
    return (
      <div className={"proof-step " + (c?.state ?? "wait")}>
        <span className="proof-n">{c?.state === "ok" ? "✓" : c?.state === "bad" ? "✕" : n}</span>
        <div><b>{label}</b><p className="sub">{c?.text ?? "Checking..."}</p>{children}</div>
      </div>
    );
  };

  return (
    <>
      <section className="guide-sec">
        <h2>{title}</h2>
        <p>{f.prize ?? "Prize"} · {f.total.toLocaleString()} tickets</p>
        {f.status === "settled" && <p className="proof-winner">Winner: <b>{f.winner_name ?? f.winner_code}</b> <span className="sub">({f.winner_code})</span></p>}
        {f.status === "no_entries" && <p className="sub">Nobody entered this draw.</p>}
        {(f.status === "frozen" || f.status === "committed") && <p className="sub">Drawing now. This page updates by itself.</p>}
        {mine && <p className="sub ok">Your code in this draw is <b className="select">{mine}</b>{f.winner_code === mine ? ". That's the winner. Congratulations!" : "."}</p>}
      </section>
      {f.status !== "no_entries" && (
        <section className="guide-sec proof">
          <Step k="list" n={1} label="The entry list was frozen" />
          <Step k="chain" n={2} label="Its fingerprint went on Solana before the randomness existed">
            {f.commit_tx && <a href={explorer(f.commit_tx, f.cluster)} target="_blank" rel="noopener noreferrer">View the Solana transaction</a>}
          </Step>
          <Step k="drand" n={3} label="Randomness came from drand, a public beacon nobody controls">
            {f.drand_round && <a href={`https://api.drand.sh/${DRAND.chain}/public/${f.drand_round}`} target="_blank" rel="noopener noreferrer">View drand round {f.drand_round}</a>}
          </Step>
          <Step k="math" n={4} label="The winner follows from the math">
            {math && <code className="proof-code">SHA-256(randomness + ":" + hash) = {math.seed.slice(0, 24)}...{"\n"}mod {f.total} = ticket {String(math.ticket)}</code>}
          </Step>
          {f.result_tx && <p className="sub small">The result was also posted on Solana: <a href={explorer(f.result_tx, f.cluster)} target="_blank" rel="noopener noreferrer">result memo</a>.</p>}
        </section>
      )}
      {f.entries.length > 0 && (
        <section className="guide-sec">
          <h2>All entries</h2>
          <p className="sub small">Players appear as codes so nobody's account is exposed. Each list is sorted by code; the winning ticket counts along it.</p>
          <div className="proof-list">
            {f.entries.map((e) => (
              <div key={e.c} className={(e.c === f.winner_code ? "win " : "") + (e.c === mine ? "me" : "")}>
                <code>{e.c}</code><span>{e.t.toLocaleString()} ticket{e.t === 1 ? "" : "s"}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      <p className="sub"><a href="/verify">All draws</a></p>
    </>
  );
}

function HowItWorks() {
  return (
    <section className="guide-sec">
      <h2>How it works</h2>
      <div className="guide-text">
        <ul>
          <li><b>Freeze.</b> When a draw closes, each player's tickets are listed under a code, sorted by code. The SHA-256 of that list is its fingerprint.</li>
          <li><b>Commit.</b> The fingerprint and a future drand round number go on Solana in a memo. From then on the list can't change without the fingerprint changing.</li>
          <li><b>Reveal.</b> About a minute later, drand (a randomness beacon run by independent organisations) publishes that round. Nobody, including us, can know or change it in advance.</li>
          <li><b>Pick.</b> Winning ticket = SHA-256(randomness + ":" + fingerprint), as a number, mod total tickets. Walking down the list adding up tickets, the first player whose total passes the winning ticket wins. More tickets means a bigger slice of the range, so odds are exactly proportional.</li>
        </ul>
        <p className="why">You don't have to trust this page either: the list, the memo and the drand round are all public, and the math is a few lines in any language.</p>
      </div>
    </section>
  );
}

// ---------- Season Pass tier reveal ----------
type Reveal = {
  id: number; name: string; starts_at: string; collection: string | null; reveal_round: number | null; randomness: string | null;
  revealed_at: string | null; split: number[]; assets: { asset: string; position: number; tier: number }[];
};
const TIER_NAMES = ["", "Common", "Uncommon", "Rare", "Epic", "Legendary"];

/** Same steps as the server: shuffle the tier deck with SHA-256(randomness:counter), deal in address order. */
async function dealDeck(randomness: string, split: number[]) {
  const deck = split.flatMap((c, t) => Array(c).fill(t + 1) as number[]);
  let counter = 0;
  for (let i = deck.length - 1; i > 0; i--) {
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`${randomness}:${counter++}`)));
    const j = (((h[0] << 24) >>> 0) + (h[1] << 16) + (h[2] << 8) + h[3]) % (i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function PassReveal({ season }: { season: number }) {
  const [r, setR] = useState<Reveal | null | undefined>(undefined);
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const [find, setFind] = useState("");
  useEffect(() => { supabase.rpc("pass_reveal_public", { p_season: season }).then(({ data }) => setR((data as Reveal) ?? null)); }, [season]);
  useEffect(() => {
    if (!r?.randomness || !r.reveal_round) return;
    const set = (k: string, c: Check) => setChecks((m) => ({ ...m, [k]: c }));
    (async () => {
      try {
        const b = await (await fetch(`https://api.drand.sh/${DRAND.chain}/public/${r.reveal_round}`)).json();
        const ok = (await sha(unhex(b.signature))) === b.randomness && b.randomness === r.randomness;
        set("drand", ok ? { state: "ok", text: `drand round ${r.reveal_round} (published ${when(roundTime(r.reveal_round!))}, after the mint closed) gave ${r.randomness!.slice(0, 16)}..., the SHA-256 of its signature.` }
          : { state: "bad", text: "The drand beacon doesn't match the randomness the game used." });
      } catch { set("drand", { state: "wait", text: "Couldn't reach drand from your browser. Use the drand link." }); }
      const deck = await dealDeck(r.randomness!, r.split);
      const sorted = r.assets.every((a, i) => i === 0 || r.assets[i - 1].asset < a.asset);
      const match = r.assets.every((a) => deck[a.position] === a.tier);
      set("deal", sorted && match ? { state: "ok", text: `Shuffling the ${deck.length}-pass deck with that randomness and dealing it to the ${r.assets.length} minted passes in address order gives exactly the tiers below.` }
        : { state: "bad", text: "Re-dealing the deck gives different tiers than the game recorded." });
    })();
  }, [r]);

  if (r === undefined) return <p className="sub">Loading the reveal...</p>;
  if (r === null) return <div className="guide-sec"><p className="sub">No season with that number.</p></div>;
  const counts = [1, 2, 3, 4, 5].map((t) => r.assets.filter((a) => a.tier === t).length);
  const shown = find.trim() ? r.assets.filter((a) => a.asset.toLowerCase().includes(find.trim().toLowerCase())) : r.assets.slice(0, 60);
  return (
    <>
      <section className="guide-sec">
        <h2>{r.name}: Season Pass tiers</h2>
        <p>Deck: {r.split.map((n, i) => `${n} ${TIER_NAMES[i + 1]}`).join(", ")}.</p>
        {!r.revealed_at
          ? <p className="sub">Not revealed yet. Tiers are dealt with drand round {r.reveal_round ?? "(set when the mint opens)"}{r.reveal_round ? `, published ${when(roundTime(r.reveal_round))}` : ""}, just after the season starts and the mint has closed. Nobody can know that number before then.</p>
          : <p className="sub">Revealed {new Date(r.revealed_at).toLocaleString()}: {counts.map((c, i) => `${c} ${TIER_NAMES[i + 1]}`).join(", ")}.</p>}
      </section>
      {r.revealed_at && (
        <section className="guide-sec proof">
          <div className={"proof-step " + (checks.drand?.state ?? "wait")}><span className="proof-n">{checks.drand?.state === "ok" ? "✓" : 1}</span>
            <div><b>The randomness came from drand, after minting closed</b><p className="sub">{checks.drand?.text ?? "Checking..."}</p>
              {r.reveal_round && <a href={`https://api.drand.sh/${DRAND.chain}/public/${r.reveal_round}`} target="_blank" rel="noopener noreferrer">View drand round {r.reveal_round}</a>}</div></div>
          <div className={"proof-step " + (checks.deal?.state ?? "wait")}><span className="proof-n">{checks.deal?.state === "ok" ? "✓" : 2}</span>
            <div><b>The tiers follow from the shuffle</b><p className="sub">{checks.deal?.text ?? "Checking..."}</p></div></div>
          <p className="sub small">The list of minted passes is the collection {r.collection}, read from the blockchain; anyone can list it with a Solana explorer or a DAS API.</p>
        </section>
      )}
      {r.assets.length > 0 && (
        <section className="guide-sec">
          <h2>Every pass</h2>
          <label className="field">Find your pass (paste its address)<input id="find-pass" value={find} onChange={(e) => setFind(e.target.value)} spellCheck={false} /></label>
          <div className="proof-list">
            {shown.map((a) => <div key={a.asset} className={a.tier >= 4 ? "win" : ""}><code>{a.asset.slice(0, 6)}...{a.asset.slice(-4)}</code><span>{TIER_NAMES[a.tier]}</span></div>)}
          </div>
          {!find && r.assets.length > 60 && <p className="sub small">Showing 60 of {r.assets.length}. Search to find yours.</p>}
        </section>
      )}
    </>
  );
}
