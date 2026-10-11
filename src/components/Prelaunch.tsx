// Pre-launch: until launch, slabhunt.fun shows the early-access signup and referral page. Admins enter the game with
// "Team sign in" (/?team). Turned off on /admin.
import { useEffect } from "react";
import Signup from "../Signup";
import { supabase } from "../lib/supabase";

export default function Prelaunch({ signedIn }: { signedIn: boolean }) {
  useEffect(() => {
    document.body.classList.add("signup-page");
    return () => document.body.classList.remove("signup-page");
  }, []);
  return (
    <>
      <Signup />
      <div className="prelaunch-foot">
        {signedIn
          ? <>The game opens at launch. <button className="link-btn" onClick={() => supabase.auth.signOut()}>Sign out</button></>
          : <a href="/?team">Team sign in</a>}
      </div>
    </>
  );
}
