import { FormEvent, useEffect, useState } from 'react';
import { ArrowLeft, Building2, KeyRound, UserPlus } from 'lucide-react';
import { operationsApi, OperationsApiError } from './operationsApi';
import { ManagedUser, OperationsSession } from './types';

interface AdminPanelProps {
  session: OperationsSession;
  onClose: () => void;
  onSessionChange: (session: OperationsSession) => void;
}

const localRoles = ['REPONEDOR', 'ENCARGADO', 'COMPRADOR', 'ADMINISTRADOR'];

export default function AdminPanel({ session, onClose, onSessionChange }: AdminPanelProps) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [storeForm, setStoreForm] = useState({ code: '', name: '', address: '' });
  const [userForm, setUserForm] = useState({ cedula: '', name: '', email: '', storeId: '', role: 'REPONEDOR' });

  const loadUsers = async () => {
    const response = await operationsApi.listUsers();
    setUsers(response.users);
  };

  useEffect(() => {
    loadUsers().catch((caught) => setError(caught instanceof Error ? caught.message : 'No se pudieron cargar los usuarios.'));
  }, []);

  const submitStore = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await operationsApi.createStore(storeForm);
      const updatedSession = await operationsApi.getSession();
      onSessionChange(updatedSession);
      setStoreForm({ code: '', name: '', address: '' });
      setNotice('Local creado.');
    } catch (caught) {
      setError(caught instanceof OperationsApiError ? caught.message : 'No se pudo crear el local.');
    } finally {
      setBusy(false);
    }
  };

  const submitUser = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await operationsApi.createUser({
        cedula: userForm.cedula,
        name: userForm.name,
        email: userForm.email,
        storeId: userForm.storeId || undefined,
        role: userForm.storeId ? userForm.role : undefined,
      });
      setUserForm({ cedula: '', name: '', email: '', storeId: '', role: 'REPONEDOR' });
      await loadUsers();
      setNotice(`Usuario creado. Codigo de activacion: ${response.activationCode}. Es valido por 24 horas.`);
    } catch (caught) {
      setError(caught instanceof OperationsApiError ? caught.message : 'No se pudo crear el usuario.');
    } finally {
      setBusy(false);
    }
  };

  const enableReset = async (user: ManagedUser) => {
    if (!window.confirm(`Habilitar un PIN nuevo para ${user.name}?`)) return;
    setBusy(true);
    setError('');
    try {
      const response = await operationsApi.enablePinReset(user.id);
      await loadUsers();
      setNotice(`Reset habilitado. Codigo de activacion: ${response.activationCode}. Es valido por 24 horas.`);
    } catch (caught) {
      setError(caught instanceof OperationsApiError ? caught.message : 'No se pudo habilitar el reset.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-neutral-100 text-neutral-900 sm:p-6">
      <section className="mx-auto min-h-screen max-w-3xl overflow-hidden bg-white sm:min-h-0 sm:rounded-3xl sm:shadow-xl">
        <header className="flex items-center gap-4 border-b border-neutral-200 px-5 py-5">
          <button onClick={onClose} className="rounded-xl p-2 text-neutral-500 hover:bg-neutral-100" aria-label="Volver a reposicion">
            <ArrowLeft size={22} />
          </button>
          <div>
            <h1 className="text-xl font-bold">Administracion</h1>
            <p className="text-sm text-neutral-500">Locales, funcionarios y acceso</p>
          </div>
        </header>

        <div className="space-y-8 p-5 sm:p-7">
          {(error || notice) && (
            <p role={error ? 'alert' : 'status'} className={`rounded-xl px-4 py-3 text-sm font-medium ${error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
              {error || notice}
            </p>
          )}

          <section>
            <div className="mb-4 flex items-center gap-2"><Building2 size={20} className="text-blue-600" /><h2 className="font-bold">Nuevo local</h2></div>
            <form onSubmit={submitStore} className="grid gap-3 sm:grid-cols-2">
              <input required placeholder="Codigo" value={storeForm.code} onChange={(event) => setStoreForm({ ...storeForm, code: event.target.value })} className="rounded-xl border border-neutral-300 px-4 py-3 outline-none focus:border-blue-500" />
              <input required placeholder="Nombre del local" value={storeForm.name} onChange={(event) => setStoreForm({ ...storeForm, name: event.target.value })} className="rounded-xl border border-neutral-300 px-4 py-3 outline-none focus:border-blue-500" />
              <input placeholder="Direccion" value={storeForm.address} onChange={(event) => setStoreForm({ ...storeForm, address: event.target.value })} className="rounded-xl border border-neutral-300 px-4 py-3 outline-none focus:border-blue-500 sm:col-span-2" />
              <button disabled={busy} className="rounded-xl bg-blue-600 px-5 py-3 font-bold text-white hover:bg-blue-700 disabled:bg-neutral-300 sm:col-span-2">Crear local</button>
            </form>
          </section>

          <section className="border-t border-neutral-200 pt-7">
            <div className="mb-4 flex items-center gap-2"><UserPlus size={20} className="text-blue-600" /><h2 className="font-bold">Nuevo funcionario</h2></div>
            <form onSubmit={submitUser} className="grid gap-3 sm:grid-cols-2">
              <input required inputMode="numeric" placeholder="Cedula" value={userForm.cedula} onChange={(event) => setUserForm({ ...userForm, cedula: event.target.value.replace(/\D/g, '') })} className="rounded-xl border border-neutral-300 px-4 py-3 outline-none focus:border-blue-500" />
              <input required placeholder="Nombre completo" value={userForm.name} onChange={(event) => setUserForm({ ...userForm, name: event.target.value })} className="rounded-xl border border-neutral-300 px-4 py-3 outline-none focus:border-blue-500" />
              <input type="email" placeholder="Email opcional" value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} className="rounded-xl border border-neutral-300 px-4 py-3 outline-none focus:border-blue-500 sm:col-span-2" />
              <select value={userForm.storeId} onChange={(event) => setUserForm({ ...userForm, storeId: event.target.value })} className="rounded-xl border border-neutral-300 bg-white px-4 py-3 outline-none focus:border-blue-500">
                <option value="">Sin local por ahora</option>
                {session.stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
              </select>
              <select value={userForm.role} onChange={(event) => setUserForm({ ...userForm, role: event.target.value })} disabled={!userForm.storeId} className="rounded-xl border border-neutral-300 bg-white px-4 py-3 outline-none focus:border-blue-500 disabled:bg-neutral-100">
                {localRoles.map((role) => <option key={role} value={role}>{role.toLowerCase()}</option>)}
              </select>
              <button disabled={busy} className="rounded-xl bg-blue-600 px-5 py-3 font-bold text-white hover:bg-blue-700 disabled:bg-neutral-300 sm:col-span-2">Crear funcionario</button>
            </form>
          </section>

          <section className="border-t border-neutral-200 pt-7">
            <h2 className="font-bold">Funcionarios</h2>
            <div className="mt-3 divide-y divide-neutral-200 border-y border-neutral-200">
              {users.map((user) => (
                <div key={user.id} className="flex items-center justify-between gap-4 py-4">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{user.name}</p>
                    <p className="text-sm text-neutral-500">CI {user.cedula || 'sin configurar'} · {user.pinStatus.toLowerCase().replace('_', ' ')}</p>
                  </div>
                  <button disabled={busy || user.id === session.user.id} onClick={() => enableReset(user)} className="flex shrink-0 items-center gap-2 rounded-lg border border-neutral-300 px-3 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-40">
                    <KeyRound size={16} /> {user.pinStatus === 'ACTIVO' ? 'Reset PIN' : 'Nuevo codigo'}
                  </button>
                </div>
              ))}
              {!users.length && <p className="py-6 text-center text-sm text-neutral-500">Cargando funcionarios...</p>}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
