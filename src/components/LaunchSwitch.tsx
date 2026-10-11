// /admin: the pre-launch switch. On: the site shows only the signup page and creatures spawn for admins only.
// Off: everyone can play. Takes two taps so it can't be flipped by accident.
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function LaunchSwitch() {
  const [on, setOn] = useState<boolean | null>(null);
  const [armed, setArmed] = useState(false);
  useEffect(() => { supabase.rpc("site_mode").then(({ data }) => setOn(!!(data as { prelaunch?: boolean } | null)?.prelaunch)); }, []);
  async function flip() {
    if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 5000); return; }
    const { data, error } = await supabase.rpc("admin_set_prelaunch", { p_on: !on });
    setArmed(false);
    if (!error) setOn(!!(data as { prelaunch?: boolean } | null)?.prelaunch);
  }
  if (on === null) return null;
  return (
    <div className={"card launch-switch" + (on ? " pre" : " live")}>
      <div>
        <b>{on ? "Pre-launch: the game is closed" : "Live: the game is open to everyone"}</b>
        <p className="sub small">{on
          ? "slabhunt.fun shows the early-access signup page. Only admins can play (sign in at slabhunt.fun/?team), and creatures spawn for admins only."
          : "Anyone can sign up and play. Turn pre-launch back on to close the game again."}</p>
      </div>
      <button className={"btn" + (on ? "" : " ghost")} onClick={flip}>{armed ? (on ? "Tap again to OPEN the game" : "Tap again to close it") : on ? "Open the game" : "Back to pre-launch"}</button>
    </div>
  );
}
