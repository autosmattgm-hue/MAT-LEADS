const base = "http://localhost:3111";
const j = async (path, opts = {}) => {
  const res = await fetch(base + path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
};
const out = [];
const email = `e2e-${Date.now()}@example.com`;

const reg = await j("/api/auth/register", { method: "POST", body: JSON.stringify({ name: "E2E Tester", email, password: "Password123" }) });
out.push(["register", reg.status, reg.body.verificationRequired ? "verificationRequired" : "NO-GATE", Boolean(reg.body.verificationToken), reg.body.accessToken ? "HAS-TOKEN" : "no-token"]);

const blocked = await j("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password: "Password123" }) });
out.push(["login-blocked", blocked.status, blocked.body?.error?.code]);

const ver = await j("/api/auth/verify-email", { method: "POST", body: JSON.stringify({ token: reg.body.verificationToken || "" }) });
out.push(["verify", ver.status, JSON.stringify(ver.body)]);

const ver2 = await j("/api/auth/verify-email", { method: "POST", body: JSON.stringify({ token: reg.body.verificationToken || "" }) });
out.push(["verify-reuse", ver2.status, ver2.body?.error?.code]);

const login = await j("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password: "Password123" }) });
out.push(["login", login.status, login.body.accessToken ? "HAS-TOKEN" : JSON.stringify(login.body).slice(0, 160)]);

const resend = await j("/api/auth/resend-verification", { method: "POST", body: JSON.stringify({ email }) });
out.push(["resend", resend.status, JSON.stringify(resend.body).slice(0, 180)]);

const owner = await j("/api/auth/login", { method: "POST", body: JSON.stringify({ email: "owner@matleads.local", password: "admin2026" }) });
out.push(["owner", owner.status, owner.body.user?.role, owner.body.user?.billingStatus]);

for (const p of ["/verify-email.html", "/login.html", "/signup.html", "/website-studio.html"]) {
  const r = await fetch(base + p);
  out.push(["page", p, r.status]);
}

console.log(JSON.stringify(out, null, 1));
