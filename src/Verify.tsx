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
  const id = Number(new URLSearchParams(location.search).get("id")) || null;
  return (
    <div className="guide">
      <header className="guide-head">
        <a href="/" className="logo">Vault <span>Hunt</span></a>
        <a className="btn small" href="/guide">How to play</a>
      </header>
      <div className="guide-body">
        <h1>Draw proof</h1>
        <p className="sub">Every Vault Hunt raffle can be checked by anyone. This page redoes each step in your browser and compares it with what the game recorded.</p>
        {id ? <Proof id={id} /> : <RecentList />}
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
