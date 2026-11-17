import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { authApi, type AuthConfig } from "@/api/auth";
import { useAuthStore } from "@/stores/authStore";
import { safeNextPath } from "@/lib/safeNext";
import { errorMessage, landingPath } from "@/lib/authLogic";
import {
  ENTRA_NOT_CONFIGURED_MESSAGE,
  entraConfigured,
  entraLoginPopup,
} from "@/auth/entra";
import { BrandLogo } from "@/components/BrandLogo";
import { Alert } from "@/ui/Feedback";
import "@/ui/ui.css";
import "./Login.css";

export function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const nextParam = params.get("next");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ssoNote, setSsoNote] = useState<string | null>(null);
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [configSettled, setConfigSettled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    authApi
      .config()
      .then((res) => {
        if (cancelled) return;
        setConfig(res.data);
        setConfigSettled(true);
      })
      .catch(() => {
        if (!cancelled) setConfigSettled(true); // config unavailable: assume the normal form
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "authenticated" && user) {
    return <Navigate to={safeNextPath(nextParam, landingPath(user))} replace />;
  }

  async function finish(accessToken: string, refreshToken: string | null) {
    const store = useAuthStore.getState();
    store.setTokens(accessToken, refreshToken);
    const me = await authApi.me();
    store.setUser(me.data);
    navigate(safeNextPath(nextParam, landingPath(me.data)), { replace: true });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSsoNote(null);
    try {
      const res = await authApi.login(email.trim(), password);
      await finish(res.data.access_token, res.data.refresh_token);
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response
        ?.status;
      if (status === 429)
        setError(
          errorMessage(
            err,
            "Too many sign-in attempts. Please wait a few minutes and try again.",
          ),
        );
      else if (status === 401) setError("Invalid email or password.");
      else if (!status)
        setError("Can't reach the Bluedge People service. Please try again.");
      else setError(errorMessage(err, "Sign in failed. Please try again."));
      useAuthStore.getState().clear();
    } finally {
      setSubmitting(false);
    }
  }

  async function onMicrosoft() {
    setError(null);
    if (!entraConfigured) {
      setSsoNote(ENTRA_NOT_CONFIGURED_MESSAGE);
      return;
    }
    setSubmitting(true);
    try {
      const { idToken, graphToken } = await entraLoginPopup();
      const res = await authApi.entraLogin(idToken, graphToken);
      await finish(res.data.access_token, res.data.refresh_token);
    } catch (err) {
      setError(errorMessage(err, "Microsoft sign-in failed."));
    } finally {
      setSubmitting(false);
    }
  }

  const passwordLogin = configSettled && config?.password_login !== false; // Microsoft-only when the server turns passwords off
  const microsoftOnly = configSettled && config?.password_login === false;

  return (
    <main className="login-container">
      <div className="login-stack">
        <div className="login-card">
          <div className="login-logo">
            <BrandLogo variant="dark" size="lg" />
          </div>
          <div className="login-heading">
            <h1>Sign in</h1>
            <p>
              {microsoftOnly
                ? "Sign in with your Microsoft account to access Bluedge People."
                : "Use your account to access Bluedge People."}
            </p>
          </div>

          {error ? <Alert tone="danger">{error}</Alert> : null}

          {passwordLogin ? (
            <>
              <form
                onSubmit={onSubmit}
                className="login-form"
                noValidate={false}
              >
                <div className="field">
                  <label className="field-label" htmlFor="email">
                    Email
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={submitting}
                  />
                </div>
                <div className="field">
                  <div className="login-label-row">
                    <label className="field-label" htmlFor="password">
                      Password
                    </label>
                    <span className="login-forgot">Forgot password?</span>
                  </div>
                  <div className="password-row">
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      disabled={submitting}
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      aria-pressed={showPassword}
                      aria-label={
                        showPassword ? "Hide password" : "Show password"
                      }
                      onClick={() => setShowPassword((v) => !v)}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      <span>{showPassword ? "Hide" : "Show"}</span>
                    </button>
                  </div>
                </div>
                <button
                  type="submit"
                  className="btn btn-primary btn-lg btn-block"
                  disabled={submitting}
                >
                  {submitting ? "Signing in..." : "Sign in"}
                </button>
              </form>

              <div className="login-divider">
                <span>Or login via SSO</span>
              </div>
            </>
          ) : null}
          <button
            type="button"
            className="btn btn-secondary btn-lg btn-block"
            onClick={() => void onMicrosoft()}
            disabled={submitting}
          >
            <span className="microsoft-mark" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
            Microsoft
          </button>
          {ssoNote ? (
            <div className="login-sso-note">
              <Alert tone="info">{ssoNote}</Alert>
            </div>
          ) : null}
        </div>

      </div>
    </main>
  );
}
