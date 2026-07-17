import { supabase } from './supabase';

export async function getSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthChange(cb) {
  if (!supabase) return { unsubscribe() {} };
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session));
  return data.subscription;
}

export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
  if (error) throw error;
  return data.session;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
  return data.session;
}

export async function signOut() {
  await supabase.auth.signOut();
}

// 내 프로필(공유 링크용 share_token) 가져오기. 트리거로 자동 생성되지만, 타이밍 대비 재시도.
export async function getMyProfile() {
  for (let i = 0; i < 5; i++) {
    const { data, error } = await supabase.from('profiles').select('*').single();
    if (data) return data;
    await new Promise(r => setTimeout(r, 400));
  }
  return null;
}

export async function updateDisplayName(name) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from('profiles').update({ display_name: name }).eq('id', user.id);
}
