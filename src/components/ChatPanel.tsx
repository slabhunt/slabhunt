import { useEffect, useRef, useState } from "react";
import { supabase, type ChatMessage } from "../lib/supabase";
import { useNames } from "../hooks/useNames";

export default function ChatPanel({ userId, visible }: { userId: string; visible: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const name = useNames(messages.map((m) => m.user_id));

  useEffect(() => {
    let alive = true;
    supabase.from("chat_messages").select("*").order("created_at", { ascending: false }).limit(60)
      .then(({ data }) => { if (alive && data) setMessages((data as ChatMessage[]).reverse()); });
    const ch = supabase.channel("chat")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" },
        (p) => setMessages((m) => [...m.slice(-99), p.new as ChatMessage]))
      .subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, []);

  useEffect(() => {
    const l = list.current;
    if (l && visible) l.scrollTop = l.scrollHeight;
  }, [messages.length, visible]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText(""); setError("");
    const { error } = await supabase.from("chat_messages").insert({ user_id: userId, body: body.slice(0, 280) });
    if (error) { setText(body); setError("Message didn't send. Check your connection and try again."); }
  }

  return (
    <>
      <h2 className="sec">World chat</h2>
      <div className="chat-list" ref={list}>
        {messages.length === 0 && <div className="empty">No messages yet. Say hi, or catch an uncommon creature to show up here.</div>}
        {messages.map((m) => (
          <div key={m.id} className={"msg" + (m.kind !== "msg" ? " event" : "")}>
            <div className="who">{name(m.user_id)}{m.user_id === userId ? " (you)" : ""}<time>{new Date(m.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></div>
            <div className="txt">{m.body}</div>
          </div>
        ))}
      </div>
      {error && <p className="err">{error}</p>}
      <form className="chat-form" onSubmit={send}>
        <input id="chat-input" value={text} onChange={(e) => setText(e.target.value)} maxLength={280} placeholder="Say hi to other hunters" autoComplete="off" />
        <button className="btn" disabled={!text.trim()}>Send</button>
      </form>
    </>
  );
}
