import { useState, useRef, useEffect, type FormEvent } from 'react';
import { Lock, User, Eye, EyeOff, ShieldCheck, AlertCircle, X } from 'lucide-react';
import batrascoLogo from '../../assets/batrasco_logo.png';
import { verifyAndAuthorizeAdmin } from '../../lib/auth/admin-auth';

type FleetMapLoginModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

export function FleetMapLoginModal({ isOpen, onClose, onSuccess }: FleetMapLoginModalProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const usernameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setUsername('');
      setPassword('');
      setError(null);
      setShowPassword(false);
      // Autofocus username on open
      setTimeout(() => {
        usernameInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const valid = verifyAndAuthorizeAdmin(username, password);
    if (valid) {
      setIsSubmitting(false);
      onSuccess();
    } else {
      setIsSubmitting(false);
      setError('Invalid username or password. Please try again.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fleet-modal-title"
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-2xl shadow-slate-900/25 transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top accent bar matching system brand colors */}
        <div
          className="h-1.5 w-full bg-gradient-to-r from-[#17256b] via-[#484d80] to-[#c23e01]"
          aria-hidden
        />

        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3.5 top-3.5 rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#253272]/40"
          aria-label="Close dialog"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="p-6 sm:p-7">
          {/* Brand Header */}
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-50 p-1 ring-1 ring-slate-200/90 shadow-sm">
              <img
                src={batrascoLogo}
                alt="Batrasco Logo"
                className="h-full w-full object-contain"
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#c23e01]">
                Fleet Operations
              </p>
              <h2
                id="fleet-modal-title"
                className="text-lg font-bold leading-tight text-[#17256b]"
              >
                Security Verification
              </h2>
            </div>
          </div>

          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            Please enter your operator credentials to access the <strong>Fleet Map</strong> controls and live telemetry.
          </p>

          {/* Form */}
          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            {error && (
              <div
                className="flex items-center gap-2.5 rounded-xl border border-red-200/90 bg-red-50/90 px-3.5 py-2.5 text-xs text-red-800 animate-in fade-in slide-in-from-top-1"
                role="alert"
              >
                <AlertCircle className="h-4 w-4 shrink-0 text-red-600" aria-hidden />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label
                htmlFor="fleet-username"
                className="block text-xs font-semibold text-slate-700"
              >
                Username
              </label>
              <div className="relative mt-1.5 rounded-lg shadow-sm">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                  <User className="h-4 w-4" aria-hidden />
                </div>
                <input
                  ref={usernameInputRef}
                  id="fleet-username"
                  type="text"
                  required
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter username"
                  className="block w-full rounded-lg border border-slate-300/90 bg-slate-50/50 py-2.5 pl-9 pr-3 text-sm text-slate-900 transition-colors placeholder:text-slate-400 focus:border-[#253272] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#253272]/20"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="fleet-password"
                className="block text-xs font-semibold text-slate-700"
              >
                Password
              </label>
              <div className="relative mt-1.5 rounded-lg shadow-sm">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                  <Lock className="h-4 w-4" aria-hidden />
                </div>
                <input
                  id="fleet-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  className="block w-full rounded-lg border border-slate-300/90 bg-slate-50/50 py-2.5 pl-9 pr-10 text-sm text-slate-900 transition-colors placeholder:text-slate-400 focus:border-[#253272] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#253272]/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600 focus:outline-none"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#253272] px-4 py-2 text-xs font-semibold text-white shadow-md shadow-[#17256b]/20 transition-all hover:bg-[#17256b] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#253272] focus-visible:ring-offset-2 disabled:opacity-50"
              >
                <ShieldCheck className="h-4 w-4" />
                <span>{isSubmitting ? 'Verifying…' : 'Unlock Fleet Map'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
