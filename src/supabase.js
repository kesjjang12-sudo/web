import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';

export const hasSupabase = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

// 서버 요청 제한 시간.
// 이게 없으면 지하철·엘리베이터처럼 인터넷이 끊길 듯 말 듯한 곳에서
// 요청이 영원히 끝나지 않아 앱이 빈 화면으로 멈춰버린다. ("됐다 안 됐다" 하던 원인)
const NET_TIMEOUT_MS = 12000;

function fetchWithTimeout(input, init = {}) {
  // supabase-js가 자체 signal을 넘기는 경우도 있으므로 둘 다 존중한다.
  const outer = init.signal;

  // 이미 취소된 요청은 fetch에 넘기지 않고 바로 끝낸다.
  // (fetch 구현에 따라 여기서 영원히 안 끝나는 경우가 있어 직접 처리)
  if (outer && outer.aborted) {
    return Promise.reject(new Error('Aborted'));
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), NET_TIMEOUT_MS);
  const onOuterAbort = () => ctrl.abort();
  if (outer) outer.addEventListener('abort', onOuterAbort, { once: true });

  return fetch(input, { ...init, signal: ctrl.signal })
    .finally(() => {
      clearTimeout(timer);
      if (outer) {
        try { outer.removeEventListener('abort', onOuterAbort); } catch (e) { /* 무시 */ }
      }
    });
}

export const supabase = hasSupabase
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
      global: { fetch: fetchWithTimeout },
    })
  : null;
