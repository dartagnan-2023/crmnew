import React, { useState, useEffect, useMemo } from 'react';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

const STATUS_OPTIONS = [
  { value: 'novo', label: 'Novo' },
  { value: 'contato', label: 'Em contato' },
  { value: 'proposta', label: 'Proposta enviada' },
  { value: 'negociacao', label: 'Negociação' },
  { value: 'ganho', label: 'Ganho' },
  { value: 'perdido', label: 'Perdido' },
];

// Formata telefone para (DD) 99999-9999 ou (DD) 9999-9999
const formatPhone = (value) => {
  const digits = (value || '').replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
};

const emptyLead = {
  name: '',
  contact: '',
  owner: '',
  ownerId: null,
  origin: '',
  stage_detail: '',
  next_contact: '',
  email: '',
  phone: '',
  channel_id: '',
  campaign: '',
  status: 'novo',
  value: 0,
  notes: '',
  is_private: false,
};

const App = () => {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [leads, setLeads] = useState([]);
  const [channels, setChannels] = useState([]);
  const [stats, setStats] = useState({});
  const [ownerFilter, setOwnerFilter] = useState('all'); // 'all', 'me', or userId
  const [statusFilter, setStatusFilter] = useState('todos');
  const [urgencyFilter, setUrgencyFilter] = useState('all'); // 'all', 'overdue', 'next3', 'today'

  const [showLeadModal, setShowLeadModal] = useState(false);
  const [editingLead, setEditingLead] = useState(null);
  const [leadForm, setLeadForm] = useState(emptyLead);

  const [showChannelModal, setShowChannelModal] = useState(false);
  const [newChannel, setNewChannel] = useState('');

  const [toast, setToast] = useState(null);
  const [showAllAgenda, setShowAllAgenda] = useState(false);
  const [agendaOwnerFilter, setAgendaOwnerFilter] = useState('todos');
  const [users, setUsers] = useState([]);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileTab, setProfileTab] = useState('me');
  const [profileForm, setProfileForm] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
  });
  const [userForm, setUserForm] = useState({
    id: null,
    name: '',
    phone: '',
    email: '',
    password: '',
    role: 'vendedor',
  });

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const isAdmin = useMemo(() => {
    if (!user) return false;
    return user.role === 'admin' || user.email === 'marketing@bhseletronica.com.br';
  }, [user]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
    setLeads([]);
    setChannels([]);
    setStats({});
    setUsers([]);
    setShowProfileModal(false);
  };

  const verifyToken = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        handleLogout();
        return;
      }
      const data = await res.json();
      setUser(data);
    } catch {
      handleLogout();
    }
  };

  useEffect(() => {
    verifyToken();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleAuth = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const endpoint = authMode === 'login' ? '/auth/login' : '/auth/register';
      const body =
        authMode === 'login'
          ? { email: authForm.email, password: authForm.password }
          : {
              name: authForm.name,
              email: authForm.email,
              phone: authForm.phone,
              password: authForm.password,
            };

      const res = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Erro na autenticação');
      }
      localStorage.setItem('token', data.token);
      setToken(data.token);
      setUser(data.user);
      setAuthForm({ name: '', email: '', phone: '', password: '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadLeads = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/leads`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setLeads(data);
    } catch (err) {
      console.error('Erro ao carregar leads:', err);
    }
  };

  const loadChannels = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/channels`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setChannels(data);
    } catch (err) {
      console.error('Erro ao carregar canais:', err);
    }
  };

  const loadUsers = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setUsers(data);
    } catch (err) {
      console.error('Erro ao carregar usuarios:', err);
    }
  };

  const loadStats = async () => {
    if (!token) return;
    try {
      const params = new URLSearchParams();
      if (isAdmin) {
        if (ownerFilter === 'all') {
          params.append('scope', 'all');
        } else if (ownerFilter && ownerFilter !== 'me') {
          params.append('userId', ownerFilter);
        }
      }
      const res = await fetch(`${API_URL}/stats?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setStats(data);
    } catch (err) {
      console.error('Erro ao carregar estatísticas:', err);
    }
  };

  const loadAll = async () => {
    await Promise.all([loadLeads(), loadChannels(), loadUsers(), loadStats()]);
  };

  useEffect(() => {
    if (user) {
      loadAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (!user) return;
    loadStats();
  }, [ownerFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportCsv = () => {
    if (!filteredLeads.length) {
      showToast('Nenhum lead para exportar', 'error');
      return;
    }
    const headers = [
      'ID',
      'Nome',
      'Email',
      'Telefone',
      'Responsavel',
      'Status',
      'Campanha',
      'Canal',
      'Valor',
      'Proximo Contato',
      'Criado em',
      'Notas',
    ];
    const rows = filteredLeads.map((l) => [
      l.id,
      `"${(l.name || '').replace(/"/g, '""')}"`,
      l.email || '',
      l.phone || '',
      l.owner || l.responsible_name || '',
      l.status || '',
      l.campaign || '',
      l.channel_name || '',
      Number(l.value || 0),
      l.next_contact || '',
      l.created_at || '',
      `"${(l.notes || '').replace(/"/g, '""')}"`,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'leads.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredLeads = useMemo(() => {
    let base = leads.map((l) => ({
      ...l,
      _ownerId: l.ownerId ?? l.user_id ?? l.userId ?? l.owner_id,
      _status: (l.status || '').toLowerCase(),
    }));
    if (ownerFilter === 'me') {
      base = base.filter((l) => {
        const oid = l._ownerId ? String(l._ownerId) : '';
        const oname = (l.owner || l.responsible_name || '').toLowerCase();
        const uname = (user?.name || '').toLowerCase();
        if (oid) return oid === String(user?.id);
        return uname && oname === uname;
      });
    } else if (ownerFilter !== 'all') {
      const targetUser = users.find((u) => String(u.id) === String(ownerFilter));
      const targetName = (targetUser?.name || '').toLowerCase();
      const targetId = String(ownerFilter);
      base = base.filter((l) => {
        const oid = l._ownerId ? String(l._ownerId) : '';
        const oname = (l.owner || l.responsible_name || '').toLowerCase();
        if (oid) return oid === targetId;
        if (targetName) return oname === targetName;
        // fallback: compare owner name with raw filter value (caso venha nome no select/planilha antiga)
        return oname === targetId.toLowerCase();
      });
    }

    if (statusFilter !== 'todos') {
      base = base.filter((l) => l._status === statusFilter);
    }

    if (urgencyFilter !== 'all') {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      base = base.filter((l) => {
        if (!l.next_contact) return false;
        const d = new Date(l.next_contact);
        if (Number.isNaN(d.getTime())) return false;
        const target = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        const today = now.getTime();
        const diffDays = (target - today) / (1000 * 60 * 60 * 24);
        if (urgencyFilter === 'overdue') return diffDays < 0;
        if (urgencyFilter === 'today') return diffDays === 0;
        if (urgencyFilter === 'next3') return diffDays >= 0 && diffDays <= 3;
        return true;
      });
    }

    return base;
  }, [leads, ownerFilter, statusFilter, urgencyFilter, user?.id]);

  const agendaBase = useMemo(() => {
    return filteredLeads
      .filter((lead) => lead.next_contact)
      .map((lead) => ({ ...lead, _nextDate: new Date(lead.next_contact) }))
      .filter((lead) => !Number.isNaN(lead._nextDate.getTime()))
      .sort((a, b) => a._nextDate - b._nextDate);
  }, [filteredLeads]);

  const agendaLeads = useMemo(() => {
    return showAllAgenda ? agendaBase : agendaBase.slice(0, 5);
  }, [agendaBase, showAllAgenda]);

  const openNewLeadModal = () => {
    setEditingLead(null);
    setLeadForm({ ...emptyLead, owner: user?.name || '', ownerId: user?.id || null });
    setShowLeadModal(true);
  };

  const openEditLeadModal = (lead) => {
    let nextContact = '';
    if (lead.next_contact) {
      const d = new Date(lead.next_contact);
      if (!Number.isNaN(d.getTime())) {
        nextContact = d.toISOString().slice(0, 10);
      }
    }

    setEditingLead(lead);
    setLeadForm({
      name: lead.name || '',
      contact: lead.contact || '',
      owner: lead.owner || lead.responsible_name || '',
      ownerId: lead.user_id || user?.id || null,
      origin: lead.origin || '',
      stage_detail: lead.stage_detail || '',
      next_contact: nextContact,
      email: lead.email || '',
      phone: lead.phone || '',
      channel_id: lead.channel_id || '',
      campaign: lead.campaign || '',
      status: lead.status || 'novo',
      value: lead.value || 0,
      notes: lead.notes || '',
      is_private: !!lead.is_private,
    });
    setShowLeadModal(true);
  };

  const saveLead = async () => {
    if (!leadForm.name || !leadForm.email) {
      showToast('Nome e email são obrigatórios', 'error');
      return;
    }
    const method = editingLead ? 'PUT' : 'POST';
    const url = editingLead
      ? `${API_URL}/leads/${editingLead.id}`
      : `${API_URL}/leads`;
    const payload = {
      ...leadForm,
      ownerId: leadForm.ownerId || user?.id || null,
      value: Number(leadForm.value) || 0,
    };
    try {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        showToast('Erro ao salvar lead', 'error');
        return;
      }
      await Promise.all([loadLeads(), loadStats()]);
      setShowLeadModal(false);
      setEditingLead(null);
      showToast(editingLead ? 'Lead atualizado' : 'Lead criado', 'success');
    } catch (err) {
      console.error('Erro ao salvar lead:', err);
      showToast('Erro ao salvar lead', 'error');
    }
  };

  const deleteLead = async (id) => {
    if (!window.confirm('Deseja realmente excluir este lead?')) return;
    try {
      const res = await fetch(`${API_URL}/leads/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        showToast('Erro ao excluir lead', 'error');
        return;
      }
      await Promise.all([loadLeads(), loadStats()]);
      showToast('Lead excluído', 'success');
    } catch (err) {
      console.error('Erro ao excluir lead:', err);
      showToast('Erro ao excluir lead', 'error');
    }
  };

  const handleAgendaContactDone = async (lead) => {
    try {
      const payload = {
        name: lead.name,
        contact: lead.contact || null,
        owner: lead.owner || lead.responsible_name || user?.name || null,
        ownerId: lead.user_id || user?.id || null,
        origin: lead.origin || null,
        stage_detail: lead.stage_detail || null,
        next_contact: null,
        email: lead.email,
        phone: lead.phone || null,
        channel_id: lead.channel_id || null,
        campaign: lead.campaign || null,
        status: lead.status || 'novo',
        value: Number(lead.value) || 0,
        notes: lead.notes || null,
        is_private: lead.is_private || 0,
      };

      const res = await fetch(`${API_URL}/leads/${lead.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Erro ao atualizar contato', 'error');
        return;
      }
      await Promise.all([loadLeads(), loadStats()]);
      showToast('Contato marcado como feito', 'success');
    } catch (err) {
      console.error('Erro ao atualizar contato:', err);
      showToast('Erro ao atualizar contato', 'error');
    }
  };

  const handleAddChannel = async () => {
    if (!newChannel.trim()) {
      showToast('Nome do canal é obrigatório', 'error');
      return;
    }
    try {
      const res = await fetch(`${API_URL}/channels`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: newChannel }),
      });
      if (!res.ok) {
        showToast('Erro ao criar canal', 'error');
        return;
      }
      setNewChannel('');
      await loadChannels();
      showToast('Canal criado', 'success');
    } catch (err) {
      console.error('Erro ao criar canal:', err);
      showToast('Erro ao criar canal', 'error');
    }
  };

  const handleDeleteChannel = async (id) => {
    if (!window.confirm('Deseja realmente excluir este canal?')) return;
    try {
      const res = await fetch(`${API_URL}/channels/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        showToast('Erro ao excluir canal', 'error');
        return;
      }
      await loadChannels();
      showToast('Canal excluído', 'success');
    } catch (err) {
      console.error('Erro ao excluir canal:', err);
      showToast('Erro ao excluir canal', 'error');
    }
  };

  const openProfileSettings = async (tab = 'me', editing = null) => {
    setProfileTab(tab);
    setProfileForm({
      name: user?.name || '',
      email: user?.email || '',
      phone: user?.phone || '',
      password: '',
    });
    setShowProfileModal(true);
    if (isAdmin) {
      await loadUsers();
      if (editing) {
        setUserForm({
          id: editing.id,
          name: editing.name || '',
          phone: editing.phone || '',
          email: editing.email || '',
          password: '',
          role: editing.role || 'vendedor',
        });
      } else {
        setUserForm({
          id: null,
          name: '',
          phone: '',
          email: '',
          password: '',
          role: 'vendedor',
        });
      }
    }
  };

  const saveProfile = async () => {
    if (!profileForm.name || !profileForm.email || !profileForm.phone) {
      showToast('Nome, email e telefone sao obrigatorios', 'error');
      return;
    }
    try {
      const res = await fetch(`${API_URL}/users/me`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(profileForm),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Erro ao atualizar perfil', 'error');
        return;
      }
      if (data.token) {
        localStorage.setItem('token', data.token);
        setToken(data.token);
      }
      setUser(data.user);
      setShowProfileModal(false);
      showToast('Perfil atualizado', 'success');
    } catch (err) {
      console.error('Erro ao atualizar perfil:', err);
      showToast('Erro ao atualizar perfil', 'error');
    }
  };

  const startNewUser = () => {
    setUserForm({
      id: null,
      name: '',
      phone: '',
      email: '',
      password: '',
      role: 'vendedor',
    });
    setProfileTab('users');
    setShowProfileModal(true);
  };

  const editExistingUser = (u) => {
    setUserForm({
      id: u.id,
      name: u.name || '',
      phone: u.phone || '',
      email: u.email || '',
      password: '',
      role: u.role || 'vendedor',
    });
    setProfileTab('users');
    setShowProfileModal(true);
  };

  const saveAdminUser = async () => {
    if (!userForm.name || !userForm.phone || !userForm.email) {
      showToast('Nome, telefone e email sao obrigatorios', 'error');
      return;
    }
    if (!userForm.id && !userForm.password) {
      showToast('Senha obrigatoria para novo usuario', 'error');
      return;
    }
    const payload = {
      name: userForm.name,
      phone: userForm.phone,
      email: userForm.email,
      role: userForm.role,
    };
    if (userForm.password) {
      payload.password = userForm.password;
    }

    const method = userForm.id ? 'PUT' : 'POST';
    const endpoint = userForm.id ? `/users/${userForm.id}` : '/users';

    try {
      const res = await fetch(`${API_URL}${endpoint}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Erro ao salvar usuario', 'error');
        return;
      }
      await loadUsers();
      if (userForm.id === user?.id) {
        await verifyToken();
      }
      setShowProfileModal(false);
      showToast(userForm.id ? 'Usuario atualizado' : 'Usuario criado', 'success');
    } catch (err) {
      console.error('Erro ao salvar usuario:', err);
      showToast('Erro ao salvar usuario', 'error');
    }
  };

  const deleteUser = async (id) => {
    if (!window.confirm('Deseja realmente excluir este usuario?')) return;
    try {
      const res = await fetch(`${API_URL}/users/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Erro ao excluir usuario', 'error');
        return;
      }
      await loadUsers();
      showToast('Usuario excluido', 'success');
    } catch (err) {
      console.error('Erro ao excluir usuario:', err);
      showToast('Erro ao excluir usuario', 'error');
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-8">
          <h1 className="text-2xl font-bold text-slate-900 mb-4 text-center">
            CRM Leads
          </h1>
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-2 rounded mb-4">
              {error}
            </div>
          )}
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setAuthMode('login')}
              className={`flex-1 py-2 rounded-lg font-semibold ${
                authMode === 'login'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              Login
            </button>
            <button
              onClick={() => setAuthMode('register')}
              className={`flex-1 py-2 rounded-lg font-semibold ${
                authMode === 'register'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              Cadastrar
            </button>
          </div>
          <form onSubmit={handleAuth} className="space-y-4">
            {authMode === 'register' && (
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Nome
                </label>
                <input
                  type="text"
                  value={authForm.name}
                  onChange={(e) =>
                    setAuthForm({ ...authForm, name: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  required
                />
              </div>
            )}
            {authMode === 'register' && (
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Telefone
                </label>
                <input
                  type="tel"
                  value={authForm.phone}
                  onChange={(e) =>
                    setAuthForm({ ...authForm, phone: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  required
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                Email
              </label>
              <input
                type="email"
                value={authForm.email}
                onChange={(e) =>
                  setAuthForm({ ...authForm, email: e.target.value })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                Senha
              </label>
              <input
                type="password"
                value={authForm.password}
                onChange={(e) =>
                  setAuthForm({ ...authForm, password: e.target.value })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 bg-blue-600 text-white rounded-lg font-semibold"
            >
              {loading ? 'Aguarde...' : authMode === 'login' ? 'Entrar' : 'Criar conta'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {toast && (
          <div
            className={`fixed top-4 right-4 px-4 py-2 rounded text-sm shadow-lg ${
              toast.type === 'error'
                ? 'bg-red-600 text-white'
                : 'bg-emerald-600 text-white'
            }`}
          >
            {toast.message}
          </div>
        )}

        <header className="bg-white rounded-xl shadow p-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">CRM Leads</h1>
            <p className="text-sm text-slate-600">Bem-vindo(a), {user.name}</p>
          </div>
          <div className="flex gap-3 flex-wrap justify-end">
            <button
              onClick={() => openProfileSettings('me')}
              className="px-3 py-2 text-sm bg-slate-200 rounded-lg"
              title="Configurações e perfil"
            >
              ⚙
            </button>
            <button
              onClick={() => setShowChannelModal(true)}
              className="px-3 py-2 text-sm bg-slate-200 rounded-lg"
            >
              Canais
            </button>
            <button
              onClick={handleLogout}
              className="px-3 py-2 text-sm bg-red-600 text-white rounded-lg"
            >
              Sair
            </button>
          </div>
        </header>

        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl shadow p-4">
            <p className="text-xs text-slate-500">Total de Leads</p>
            <p className="text-2xl font-bold text-slate-900">{stats.total || 0}</p>
          </div>
          <div className="bg-white rounded-xl shadow p-4">
            <p className="text-xs text-slate-500">Novos</p>
            <p className="text-2xl font-bold text-slate-900">{stats.novos || 0}</p>
          </div>
          <div className="bg-white rounded-xl shadow p-4">
            <p className="text-xs text-slate-500">Taxa de Conversão</p>
            <p className="text-2xl font-bold text-slate-900">
              {stats.taxaConversao || 0}%
            </p>
          </div>
          <div className="bg-white rounded-xl shadow p-4">
            <p className="text-xs text-slate-500">Valor Convertido</p>
            <p className="text-2xl font-bold text-slate-900">
              R$ {(stats.valorTotal || 0).toLocaleString('pt-BR')}
            </p>
          </div>
          <div className="bg-white rounded-xl shadow p-4">
            <p className="text-xs text-slate-500">Perdidos</p>
            <p className="text-2xl font-bold text-slate-900">{stats.perdidos || 0}</p>
            <p className="text-xs text-slate-500 mt-1">
              Valor perdido: R$ {(stats.valorPerdido || 0).toLocaleString('pt-BR')}
            </p>
          </div>
          <div className="bg-white rounded-xl shadow p-4">
            <p className="text-xs text-slate-500">Em negociação</p>
            <p className="text-2xl font-bold text-slate-900">{stats.qtdNegociacao || 0}</p>
            <p className="text-xs text-slate-500 mt-1">
              Valor em neg.: R$ {(stats.valorNegociacao || 0).toLocaleString('pt-BR')}
            </p>
          </div>
        </section>

        <div className="bg-white rounded-xl shadow p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm font-semibold text-slate-800">Filtros</div>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <select
              value={ownerFilter}
              onChange={(e) => {
                const val = e.target.value;
                setOwnerFilter(val);
                setAgendaOwnerFilter(val === 'all' ? 'todos' : val);
              }}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
            >
              {isAdmin && <option value="all">Todos os responsáveis</option>}
              <option value="me">Meus</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.role})
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
            >
              <option value="todos">Todos os status</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <select
              value={urgencyFilter}
              onChange={(e) => setUrgencyFilter(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
            >
              <option value="all">Toda agenda</option>
              <option value="overdue">Vencidos</option>
              <option value="today">Hoje</option>
              <option value="next3">Próx. 3 dias</option>
            </select>
          </div>
        </div>

        {agendaLeads.length > 0 && (
          <section className="bg-white rounded-xl shadow p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-slate-900">
                Agenda - Próximos Contatos
              </h2>
              {agendaBase.length > 5 && (
                <button
                  onClick={() => setShowAllAgenda((v) => !v)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  {showAllAgenda ? 'Mostrar menos' : 'Ver toda agenda'}
                </button>
              )}
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {agendaLeads.map((lead) => {
                const now = new Date();
                now.setHours(0, 0, 0, 0);
                const date = new Date(lead.next_contact);
                const responsible = lead.owner || lead.responsible_name;
                let rowClasses =
                  'flex items-center justify-between px-3 py-2 border rounded-lg text-sm cursor-pointer ';
                if (!Number.isNaN(date.getTime())) {
                  const today = now.getTime();
                  const day = new Date(
                    date.getFullYear(),
                    date.getMonth(),
                    date.getDate()
                  ).getTime();
                  const isToday = day === today;
                  const isOverdue = day < today;
                  if (isOverdue) {
                    rowClasses += 'border-red-200 bg-red-50 hover:bg-red-100';
                  } else if (isToday) {
                    rowClasses += 'border-amber-200 bg-amber-50 hover:bg-amber-100';
                  } else {
                    rowClasses += 'border-slate-200 hover:bg-slate-50';
                  }
                } else {
                  rowClasses += 'border-slate-200 hover:bg-slate-50';
                }

                return (
                  <div
                    key={lead.id}
                    className={rowClasses}
                    onClick={() => openEditLeadModal(lead)}
                  >
                    <div>
                      <p className="font-semibold text-slate-800">
                        {lead.name} {lead.contact ? `- ${lead.contact}` : ''}
                      </p>
                      {responsible && (
                        <p className="text-xs text-slate-500">
                          Responsável: {responsible}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-xs text-slate-600">
                          {lead.next_contact
                            ? new Date(lead.next_contact).toLocaleDateString('pt-BR')
                            : '-'}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {lead.status || '-'}
                        </p>
                      </div>
                      <div
                        className="flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          className="h-3 w-3 text-blue-600 border-slate-300 rounded"
                          onChange={() => handleAgendaContactDone(lead)}
                        />
                        <span className="text-[11px] text-slate-600">
                          Contato feito
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="bg-white rounded-xl shadow p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-900">Leads</h2>
            <div className="flex gap-2">
              <button
                onClick={exportCsv}
                className="px-4 py-2 bg-slate-200 text-slate-800 rounded-lg text-sm"
              >
                Exportar CSV
              </button>
              <button
                onClick={openNewLeadModal}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm"
              >
                Novo Lead
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="py-2 px-2">Nome</th>
                  <th className="py-2 px-2">Email</th>
                  <th className="py-2 px-2">Telefone</th>
                  <th className="py-2 px-2">Canal</th>
                  <th className="py-2 px-2">Status</th>
                  <th className="py-2 px-2">Responsável</th>
                  <th className="py-2 px-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredLeads.map((lead) => (
                  <tr key={lead.id} className="border-b last:border-none">
                    <td className="py-2 px-2">{lead.name}</td>
                    <td className="py-2 px-2">{lead.email}</td>
                    <td className="py-2 px-2">{lead.phone || '-'}</td>
                    <td className="py-2 px-2">{lead.channel_name || '-'}</td>
                    <td className="py-2 px-2">{lead.status}</td>
                    <td className="py-2 px-2">
                      {lead.owner || lead.responsible_name || '-'}
                    </td>
                    <td className="py-2 px-2 text-right space-x-2">
                      <button
                        onClick={() => openEditLeadModal(lead)}
                        className="text-blue-600 text-xs"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => deleteLead(lead.id)}
                        className="text-red-600 text-xs"
                      >
                        Excluir
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredLeads.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="py-4 text-center text-slate-500 text-xs"
                    >
                      Nenhum lead cadastrado
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {showLeadModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
              <div className="p-4 border-b border-slate-200">
                <h2 className="text-lg font-semibold text-slate-900">
                  {editingLead ? 'Editar Lead' : 'Novo Lead'}
                </h2>
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Nome *
                  </label>
                  <input
                    type="text"
                    value={leadForm.name}
                    onChange={(e) =>
                      setLeadForm({ ...leadForm, name: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Email *
                  </label>
                  <input
                    type="email"
                    value={leadForm.email}
                    onChange={(e) =>
                      setLeadForm({ ...leadForm, email: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Telefone
                  </label>
                  <input
                    type="text"
                    value={leadForm.phone || ''}
                    onChange={(e) =>
                      setLeadForm({ ...leadForm, phone: formatPhone(e.target.value) })
                    }
                    maxLength={16}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Responsável
                  </label>
                  <select
                    value={leadForm.ownerId || ''}
                    onChange={(e) => {
                      const selectedId = e.target.value ? Number(e.target.value) : null;
                      const selectedUser = users.find((u) => u.id === selectedId);
                      setLeadForm({
                        ...leadForm,
                        ownerId: selectedId,
                        owner: selectedUser ? selectedUser.name : user?.name || '',
                      });
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                  >
                    <option value={user?.id || ''}>
                      {user?.name ? `${user.name} (Você)` : 'Selecione'}
                    </option>
                    {users
                      .filter((u) => u.id !== user?.id)
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({u.role})
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Canal
                  </label>
                  <select
                    value={leadForm.channel_id || ''}
                    onChange={(e) =>
                      setLeadForm({ ...leadForm, channel_id: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                  >
                    <option value="">Selecione</option>
                    {channels.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Campanha
                  </label>
                  <input
                    type="text"
                    value={leadForm.campaign || ''}
                    onChange={(e) =>
                      setLeadForm({ ...leadForm, campaign: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Valor (R$)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={leadForm.value}
                    onChange={(e) =>
                      setLeadForm({ ...leadForm, value: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Status
                  </label>
                  <select
                    value={leadForm.status}
                    onChange={(e) =>
                      setLeadForm({ ...leadForm, status: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Próximo contato (agenda)
                  </label>
                  <input
                    type="date"
                    value={leadForm.next_contact || ''}
                    onChange={(e) =>
                      setLeadForm({ ...leadForm, next_contact: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="lead-private"
                    checked={!!leadForm.is_private}
                    onChange={(e) =>
                      setLeadForm({
                        ...leadForm,
                        is_private: e.target.checked,
                      })
                    }
                    className="h-4 w-4 text-blue-600 border-slate-300 rounded"
                  />
                  <label
                    htmlFor="lead-private"
                    className="text-xs font-semibold text-slate-700"
                  >
                    Visível apenas para mim
                  </label>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Observações
                  </label>
                  <textarea
                    value={leadForm.notes}
                    onChange={(e) =>
                      setLeadForm({ ...leadForm, notes: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    rows={3}
                  />
                </div>
              </div>
              <div className="p-4 border-t border-slate-200 flex justify-end gap-2">
                <button
                  onClick={() => {
                    setShowLeadModal(false);
                    setEditingLead(null);
                  }}
                  className="px-4 py-2 text-sm border border-slate-300 rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  onClick={saveLead}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg"
                >
                  Salvar
                </button>
              </div>
            </div>
          </div>
        )}

        {showProfileModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                <div className="flex gap-2">
                  <button
                    onClick={() => setProfileTab('me')}
                    className={`px-3 py-2 text-sm rounded-lg ${
                      profileTab === 'me' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    Meu perfil
                  </button>
                  {isAdmin && (
                    <button
                      onClick={() => {
                        setProfileTab('users');
                        loadUsers();
                        setUserForm({
                          id: null,
                          name: '',
                          phone: '',
                          email: '',
                          password: '',
                          role: 'vendedor',
                        });
                      }}
                      className={`px-3 py-2 text-sm rounded-lg ${
                        profileTab === 'users'
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      Usuários
                    </button>
                  )}
                </div>
                <button
                  onClick={() => setShowProfileModal(false)}
                  className="text-sm text-slate-500 hover:text-slate-800"
                >
                  Fechar
                </button>
              </div>

              {profileTab === 'me' && (
                <div className="p-4 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Nome</label>
                      <input
                        type="text"
                        value={profileForm.name}
                        onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Telefone</label>
                      <input
                        type="tel"
                        value={profileForm.phone}
                        onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Email</label>
                    <input
                      type="email"
                      value={profileForm.email}
                      onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Nova senha (opcional)
                    </label>
                    <input
                      type="password"
                      value={profileForm.password}
                      onChange={(e) => setProfileForm({ ...profileForm, password: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                      placeholder="Deixe em branco para manter"
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                    <button
                      onClick={() => setShowProfileModal(false)}
                      className="px-4 py-2 text-sm border border-slate-300 rounded-lg"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={saveProfile}
                      className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg"
                    >
                      Salvar
                    </button>
                  </div>
                </div>
              )}

              {profileTab === 'users' && isAdmin && (
                <div className="p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-800">
                      {userForm.id ? 'Editar usuário' : 'Novo usuário'}
                    </h3>
                    <button
                      onClick={startNewUser}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      Novo
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Nome</label>
                      <input
                        type="text"
                        value={userForm.name}
                        onChange={(e) => setUserForm({ ...userForm, name: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Telefone</label>
                      <input
                        type="tel"
                        value={userForm.phone}
                        onChange={(e) => setUserForm({ ...userForm, phone: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Email</label>
                      <input
                        type="email"
                        value={userForm.email}
                        onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Senha {userForm.id ? '(opcional)' : ''}
                      </label>
                      <input
                        type="password"
                        value={userForm.password}
                        onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                        placeholder={userForm.id ? 'Deixe em branco para manter' : ''}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Papel</label>
                      <select
                        value={userForm.role}
                        onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                      >
                        <option value="vendedor">Vendedor</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setShowProfileModal(false)}
                      className="px-4 py-2 text-sm border border-slate-300 rounded-lg"
                    >
                      Fechar
                    </button>
                    <button
                      onClick={saveAdminUser}
                      className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg"
                    >
                      {userForm.id ? 'Salvar alterações' : 'Criar usuário'}
                    </button>
                  </div>
                  <div className="border-t border-slate-200 pt-4">
                    <h4 className="text-xs font-semibold text-slate-600 mb-2">Usuários</h4>
                    <div className="max-h-64 overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-slate-500">
                            <th className="py-2 px-2">Nome</th>
                            <th className="py-2 px-2">Email</th>
                            <th className="py-2 px-2">Telefone</th>
                            <th className="py-2 px-2">Papel</th>
                            <th className="py-2 px-2 text-right">Ações</th>
                          </tr>
                        </thead>
                        <tbody>
                          {users.map((u) => (
                            <tr key={u.id} className="border-b last:border-none">
                              <td className="py-2 px-2">{u.name}</td>
                              <td className="py-2 px-2">{u.email}</td>
                              <td className="py-2 px-2">{u.phone || '-'}</td>
                              <td className="py-2 px-2">{u.role}</td>
                              <td className="py-2 px-2 text-right space-x-2">
                                <button
                                  onClick={() => editExistingUser(u)}
                                  className="text-blue-600 text-xs"
                                >
                                  Editar
                                </button>
                                <button
                                  onClick={() => deleteUser(u.id)}
                                  className="text-red-600 text-xs"
                                >
                                  Excluir
                                </button>
                              </td>
                            </tr>
                          ))}
                          {users.length === 0 && (
                            <tr>
                              <td
                                colSpan={5}
                                className="py-3 text-center text-slate-500 text-xs"
                              >
                                Nenhum usuário cadastrado
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {showChannelModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
              <div className="p-4 border-b border-slate-200">
                <h2 className="text-lg font-semibold text-slate-900">Canais</h2>
              </div>
              <div className="p-4 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Novo canal
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newChannel}
                      onChange={(e) => setNewChannel(e.target.value)}
                      className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                    <button
                      onClick={handleAddChannel}
                      className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg"
                    >
                      Adicionar
                    </button>
                  </div>
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {channels.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between px-3 py-2 border border-slate-200 rounded-lg text-sm"
                    >
                      <span>{c.name}</span>
                      <button
                        onClick={() => handleDeleteChannel(c.id)}
                        className="text-xs text-red-600"
                      >
                        Excluir
                      </button>
                    </div>
                  ))}
                  {channels.length === 0 && (
                    <p className="text-xs text-slate-500">
                      Nenhum canal cadastrado
                    </p>
                  )}
                </div>
              </div>
              <div className="p-4 border-t border-slate-200 flex justify-end">
                <button
                  onClick={() => setShowChannelModal(false)}
                  className="px-4 py-2 text-sm border border-slate-300 rounded-lg"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
