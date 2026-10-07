// Firebase 연결 정보. 비밀번호가 아니라 '보관소 주소' 같은 정보라 코드에 공개돼도 괜찮다.
// 실제 보호는 ① 로그인(가입은 막아 두고 내 계정만 있음) ② Firestore 보안 규칙(본인 기록만 읽기·쓰기)
// ③ 기록 암호화(로그인 비밀번호로 이 기기에서 잠근 뒤에만 올림)가 한다.

window.LM = window.LM || {};

window.LM.FIREBASE = {
  apiKey: 'AIzaSyAkzBaA1dvCuxNrPTXDkLi1qLN-dQDrf5A',
  authDomain: 'life-maker-1e69a.firebaseapp.com',
  projectId: 'life-maker-1e69a',
  storageBucket: 'life-maker-1e69a.firebasestorage.app',
  messagingSenderId: '352610189402',
  appId: '1:352610189402:web:d438c99a7723de6c3f9863',
};
