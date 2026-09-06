import { FormEvent, useState } from 'react';
import { ArrowLeft, ArrowRight, KeyRound, PackageOpen } from 'lucide-react';
import { operationsApi, OperationsApiError } from './operationsApi';
import { OperationsSession } from './types';

interface LoginScreenProps {
  onAuthenticated: (session: OperationsSession) => void;
}

export default function LoginScreen({ onAuthenticated }: LoginScreenProps) {
  const [step, setStep] = useState<'CEDULA' | 'PIN' | 'SET_PIN'>('CEDULA');
  const [cedula, setCedula] = useState('');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [activationCode, setActivationCode] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (step === 'CEDULA') {
        const identity = await operationsApi.identify(cedula);
        setCedula(identity.cedula);
        setName(identity.name);
        setStep(identity.mode === 'SET_PIN' ? 'SET_PIN' : 'PIN');
        return;
      }
      if (step === 'SET_PIN' && pin !== confirmation) {
        setError('Los PIN no coinciden.');
        return;
      }
      const session = step === 'SET_PIN'
        ? await operationsApi.setPin(cedula, pin, activationCode)
        : await operationsApi.login(cedula, pin);
      onAuthenticated(session);
    } catch (caught) {
      setError(caught instanceof OperationsApiError ? caught.message : 'No se pudo iniciar sesion.');
    } finally {
      setSubmitting(false);
    }
  };

  const goBack = () => {
    setStep('CEDULA');
    setPin('');
    setActivationCode('');
    setConfirmation('');
    setError('');
  };

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-8 text-neutral-900 sm:grid sm:place-items-center">
      <section className="mx-auto w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-xl shadow-neutral-300/40">
        <div className="bg-blue-600 px-7 pb-8 pt-9 text-white">
          <PackageOpen size={34} strokeWidth={2.2} />
          <h1 className="mt-5 text-3xl font-bold tracking-tight">Reposicion</h1>
          <p className="mt-2 max-w-xs text-sm leading-relaxed text-blue-100">
            Ingresa para trabajar con la lista compartida de tu local.
          </p>
        </div>

        <form onSubmit={submit} className="p-7">
          {step !== 'CEDULA' && (
            <button type="button" onClick={goBack} className="mb-5 flex items-center gap-1 text-sm font-medium text-neutral-500 hover:text-neutral-800">
              <ArrowLeft size={16} /> Cambiar cedula
            </button>
          )}

          <h2 className="text-xl font-bold text-neutral-900">
            {step === 'CEDULA' ? 'Identificate' : step === 'PIN' ? `Hola, ${name}` : 'Crea tu PIN'}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-neutral-500">
            {step === 'CEDULA' && 'Usa la cedula registrada por el encargado.'}
            {step === 'PIN' && 'Introduce tu PIN personal de seis numeros.'}
            {step === 'SET_PIN' && 'Lo utilizaras para tus proximos ingresos.'}
          </p>

          <div className="mt-6 space-y-4">
            {step === 'CEDULA' ? (
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-neutral-700">Cedula</span>
                <input
                  value={cedula}
                  onChange={(event) => setCedula(event.target.value.replace(/\D/g, ''))}
                  inputMode="numeric"
                  autoComplete="username"
                  autoFocus
                  placeholder="Ej. 45678901"
                  className="w-full rounded-xl border border-neutral-300 px-4 py-3.5 text-lg outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                />
              </label>
            ) : (
              <>
                {step === 'SET_PIN' && (
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-neutral-700">Codigo de activacion</span>
                    <input
                      value={activationCode}
                      onChange={(event) => setActivationCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      autoFocus
                      placeholder="Entregado por el encargado"
                      className="w-full rounded-xl border border-neutral-300 px-4 py-3.5 text-center text-lg font-bold tracking-[0.2em] outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                    />
                  </label>
                )}
                <label className="block">
                  <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-neutral-700"><KeyRound size={16} /> PIN</span>
                  <input
                    value={pin}
                    onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    type="password"
                    inputMode="numeric"
                    autoComplete={step === 'SET_PIN' ? 'new-password' : 'current-password'}
                    autoFocus={step === 'PIN'}
                    placeholder="6 numeros"
                    className="w-full rounded-xl border border-neutral-300 px-4 py-3.5 text-center text-2xl font-bold tracking-[0.35em] outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                  />
                </label>
                {step === 'SET_PIN' && (
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-neutral-700">Repite el PIN</span>
                    <input
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value.replace(/\D/g, '').slice(0, 6))}
                      type="password"
                      inputMode="numeric"
                      autoComplete="new-password"
                      placeholder="6 numeros"
                      className="w-full rounded-xl border border-neutral-300 px-4 py-3.5 text-center text-2xl font-bold tracking-[0.35em] outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                    />
                  </label>
                )}
              </>
            )}
          </div>

          {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}

          <button
            type="submit"
            disabled={submitting || (step === 'CEDULA' ? cedula.length < 6 : pin.length !== 6 || (step === 'SET_PIN' && (confirmation.length !== 6 || activationCode.length !== 6)))}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3.5 font-bold text-white transition hover:bg-blue-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-neutral-300"
          >
            {submitting ? 'Verificando...' : step === 'CEDULA' ? 'Continuar' : step === 'SET_PIN' ? 'Guardar PIN e ingresar' : 'Ingresar'}
            {!submitting && <ArrowRight size={19} />}
          </button>
        </form>
      </section>
    </main>
  );
}
