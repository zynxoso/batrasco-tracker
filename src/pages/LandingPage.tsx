import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  MapPin,
  Clock,
  Activity,
  Navigation,
  Building2,
  Bus,
  Car,
  Truck,
  ArrowRight,
  CheckCircle2,
} from 'lucide-react';
import batrascoLogo from '../assets/batrasco_logo.png';
import batStateULogo from '../assets/01e4d074c0b38b0f06f0e0063d950c77a6441659.png';

export function LandingPage() {
  const navigate = useNavigate();
  const [selectedProvider, setSelectedProvider] = useState<'batrasco' | null>(null);

  const features = [
    {
      title: 'Real-time Location',
      description: 'Track vehicles with GPS accuracy',
      icon: MapPin,
    },
    {
      title: 'ETA Calculation',
      description: 'Estimated arrival times for all stations',
      icon: Clock,
    },
    {
      title: 'Live Status',
      description: 'Monitor operational status and delays',
      icon: Activity,
    },
    {
      title: 'Route Visualization',
      description: 'Interactive route maps and tracking',
      icon: Navigation,
    },
  ];

  const providers = [
    {
      id: 'batrasco' as const,
      name: 'BATRASCO',
      subtitle: 'Batangas Transport Cooperative',
      description: 'Serving Batangas communities since 1995',
      available: true,
      color: 'from-blue-600 to-indigo-700',
    },
    {
      id: 'alps' as const,
      name: 'ALPS',
      subtitle: 'ALPS The Bus',
      description: 'Premium bus services across Luzon',
      available: false,
      color: 'from-rose-600 to-rose-800',
    },
    {
      id: 'dltb' as const,
      name: 'DLTB',
      subtitle: 'DLTB Co. Inc.',
      description: 'Leading bus operator in Southern Luzon',
      available: false,
      color: 'from-emerald-600 to-teal-800',
    },
    {
      id: 'japs' as const,
      name: 'JAPS',
      subtitle: 'JAM Liner Premium Services',
      description: 'Comfortable intercity bus transportation',
      available: false,
      color: 'from-amber-600 to-orange-800',
    },
  ];

  const vehicleTypes = [
    {
      id: 'modern-jeepney',
      title: 'Modern Jeepney',
      description: 'SM Lipa - Batangas Grand Terminal Route',
      icon: Bus,
      available: true,
      buttonText: 'Access System',
    },
    {
      id: 'public-bus',
      title: 'Public Bus',
      description: 'Long-distance transportation tracking',
      icon: Bus,
      available: false,
      buttonText: 'Coming Soon',
    },
    {
      id: 'shuttle-service',
      title: 'Shuttle Service',
      description: 'University and corporate shuttle tracking',
      icon: Car,
      available: false,
      buttonText: 'Coming Soon',
    },
    {
      id: 'delivery-fleet',
      title: 'Delivery Fleet',
      description: 'Logistics and delivery vehicle monitoring',
      icon: Truck,
      available: false,
      buttonText: 'Coming Soon',
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100/90 via-slate-50 to-white text-slate-800 flex flex-col selection:bg-[#253272]/15 selection:text-[#17256b]">
      {/* Top Header Bar */}
      <header className="sticky top-0 z-30 w-full border-b border-slate-200/80 bg-white/90 px-4 py-2.5 backdrop-blur-md shadow-xs sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white p-1 ring-1 ring-slate-200 shadow-sm">
              <img
                src={batrascoLogo}
                alt="Batrasco Logo"
                className="h-full w-full object-contain"
              />
            </div>
            <div className="min-w-0">
              <span className="flex items-center gap-1.5 text-sm font-bold tracking-tight text-[#17256b] sm:text-base">
                <Navigation className="h-4 w-4 text-[#c23e01]" />
                GPS Tracking System
              </span>
              <p className="text-[11px] font-medium text-slate-500 sm:text-xs">
                Real-time Vehicle Monitoring
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-[11px] font-semibold text-slate-700">Powered by</p>
              <p className="text-xs font-bold text-[#17256b]">Batangas State University</p>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white p-1 ring-1 ring-slate-200 shadow-sm">
              <img
                src={batStateULogo}
                alt="Batangas State University Logo"
                className="h-full w-full object-contain"
              />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        {/* Hero Section */}
        <section className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#17256b]/15 bg-blue-50/70 px-3.5 py-1 text-xs font-semibold text-[#17256b] shadow-2xs">
            <span className="h-2 w-2 rounded-full bg-[#c23e01] animate-pulse" />
            Live Public Transport Platform
          </div>
          <h1 className="mt-3 text-balance text-3xl font-extrabold tracking-tight text-[#17256b] sm:text-4xl lg:text-5xl">
            GPS-Based Vehicle Tracking System
          </h1>
          <p className="mx-auto mt-2 max-w-2xl text-balance text-sm leading-relaxed text-slate-600 sm:text-base">
            Real-time monitoring and tracking solution for modern transportation systems across Batangas Province.
          </p>

          {/* 4 Feature Cards */}
          <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 sm:gap-4">
            {features.map((feat, idx) => {
              const Icon = feat.icon;
              return (
                <div
                  key={idx}
                  className="flex items-start gap-3 rounded-xl border border-slate-200/90 bg-white p-3.5 text-left shadow-xs transition-all hover:border-[#17256b]/30 hover:shadow-md"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#253272] to-[#484d80] text-white shadow-sm">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-bold text-slate-900">{feat.title}</h2>
                    <p className="mt-0.5 text-xs text-slate-500 leading-snug">{feat.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Section 1: Select Transport Provider */}
        <section className="mt-12">
          <div className="text-center">
            <h2 className="text-xl font-bold tracking-tight text-[#17256b] sm:text-2xl">
              Select Transport Provider
            </h2>
            <p className="mt-1 text-xs text-slate-500 sm:text-sm">
              Choose your transport cooperative or service provider
            </p>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {providers.map((p) => {
              const isSelected = selectedProvider === p.id;
              return (
                <div
                  key={p.id}
                  onClick={() => {
                    if (p.available) {
                      setSelectedProvider(p.id);
                    }
                  }}
                  className={`group relative flex flex-col justify-between overflow-hidden rounded-2xl border-2 p-5 transition-all ${
                    p.available
                      ? isSelected
                        ? 'border-[#253272] bg-blue-50/50 shadow-lg shadow-[#17256b]/10 ring-2 ring-[#253272]/30 cursor-pointer'
                        : 'border-slate-200/90 bg-white shadow-xs hover:border-[#253272]/60 hover:shadow-md cursor-pointer'
                      : 'border-slate-200/70 bg-slate-100/70 opacity-65 cursor-not-allowed'
                  }`}
                >
                  {/* Top card bar accent */}
                  <div
                    className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${p.color}`}
                    aria-hidden
                  />

                  <div>
                    <div className="flex items-center justify-between">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-[#17256b] ring-1 ring-slate-200/80 shadow-xs">
                        <Building2 className="h-5 w-5" />
                      </div>
                      {p.available && isSelected && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Selected
                        </span>
                      )}
                    </div>

                    <h3 className="mt-4 text-lg font-bold tracking-tight text-slate-900">
                      {p.name}
                    </h3>
                    <p className="text-xs font-semibold text-[#17256b]/90">{p.subtitle}</p>
                    <p className="mt-2 text-xs leading-relaxed text-slate-500">
                      {p.description}
                    </p>
                  </div>

                  <div className="mt-6 pt-2">
                    {p.available ? (
                      <button
                        type="button"
                        className={`flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-bold transition-all ${
                          isSelected
                            ? 'bg-[#253272] text-white shadow-md shadow-[#17256b]/20'
                            : 'border border-[#253272] bg-white text-[#253272] hover:bg-[#253272] hover:text-white'
                        }`}
                      >
                        {isSelected ? 'Selected' : 'Select'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled
                        className="w-full rounded-xl border border-slate-300 bg-slate-200/80 py-2.5 text-xs font-semibold text-slate-500 cursor-not-allowed"
                      >
                        Coming Soon
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Section 2: Select Vehicle Type (Visible only after selecting BATRASCO) */}
        <AnimatePresence>
          {selectedProvider === 'batrasco' && (
            <motion.section
              key="vehicle-selection"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              className="mt-12 scroll-mt-20"
            >
              <div className="text-center">
                <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800 ring-1 ring-emerald-200">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Provider Selected: BATRASCO
                </div>
                <h2 className="mt-2 text-xl font-bold tracking-tight text-[#17256b] sm:text-2xl">
                  Select Vehicle Type
                </h2>
                <p className="mt-1 text-xs text-slate-500 sm:text-sm">
                  Choose the type of vehicle to track
                </p>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {vehicleTypes.map((v) => {
                  const Icon = v.icon;
                  return (
                    <div
                      key={v.id}
                      className={`flex flex-col justify-between rounded-2xl border-2 p-5 transition-all ${
                        v.available
                          ? 'border-[#253272]/90 bg-white shadow-md hover:border-[#17256b] hover:shadow-lg'
                          : 'border-slate-200/70 bg-slate-100/70 opacity-65 cursor-not-allowed'
                      }`}
                    >
                      <div>
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-[#17256b] ring-1 ring-blue-200/70 shadow-xs">
                          <Icon className="h-5 w-5" />
                        </div>
                        <h3 className="mt-4 text-base font-bold text-slate-900">{v.title}</h3>
                        <p className="mt-1 text-xs leading-relaxed text-slate-500">
                          {v.description}
                        </p>
                      </div>

                      <div className="mt-6 pt-2">
                        {v.available ? (
                          <button
                            type="button"
                            onClick={() => navigate('/tracker')}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#17256b] to-[#253272] py-2.5 text-xs font-bold text-white shadow-md shadow-[#17256b]/25 transition-all hover:opacity-95 active:scale-[0.99]"
                          >
                            <span>{v.buttonText}</span>
                            <ArrowRight className="h-4 w-4" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled
                            className="w-full rounded-xl border border-slate-300 bg-slate-200/80 py-2.5 text-xs font-semibold text-slate-500 cursor-not-allowed"
                          >
                            {v.buttonText}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Partnership / Footer Banner */}
        <section className="mt-14 mb-4">
          <div className="relative overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-6 shadow-sm sm:p-8">
            <div
              className="absolute left-0 top-0 h-full w-1.5 bg-gradient-to-b from-[#17256b] via-[#484d80] to-[#c23e01]"
              aria-hidden
            />
            <div className="flex flex-col items-center justify-between gap-6 text-center md:flex-row md:text-left">
              <div className="max-w-xl">
                <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#c23e01]">
                  Institutional Partnership
                </span>
                <h3 className="mt-1 text-lg font-bold text-[#17256b] sm:text-xl">
                  Batangas State University & Batangas Transport Cooperative
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-500 sm:text-sm">
                  A research and technological development collaboration between Batangas State University (The National Engineering University) and BATRASCO to modernize and optimize public transport dispatch and passenger tracking.
                </p>
              </div>

              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white p-1.5 ring-1 ring-slate-200 shadow-sm">
                  <img
                    src={batStateULogo}
                    alt="BatStateU"
                    className="h-full w-full object-contain"
                  />
                </div>
                <span className="text-sm font-bold text-slate-300">×</span>
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white p-1.5 ring-1 ring-slate-200 shadow-sm">
                  <img
                    src={batrascoLogo}
                    alt="BATRASCO"
                    className="h-full w-full object-contain"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer copyright */}
      <footer className="border-t border-slate-200/80 bg-white py-4 text-center text-xs text-slate-400">
        <p>© {new Date().getFullYear()} Batangas Transport Cooperative & Batangas State University. All rights reserved.</p>
      </footer>
    </div>
  );
}
