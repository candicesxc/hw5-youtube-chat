import { useState } from 'react';
import Auth from './components/Auth';
import Chat from './components/Chat';
import './App.css';

function App() {
  const [user, setUser] = useState(() => {
    const u = localStorage.getItem('chatapp_user');
    const fn = localStorage.getItem('chatapp_firstName');
    const ln = localStorage.getItem('chatapp_lastName');
    return u ? { username: u, firstName: fn, lastName: ln } : null;
  });

  const handleLogin = (username, firstName, lastName) => {
    localStorage.setItem('chatapp_user', username);
    localStorage.setItem('chatapp_firstName', firstName || '');
    localStorage.setItem('chatapp_lastName', lastName || '');
    setUser({ username, firstName, lastName });
  };

  const handleLogout = () => {
    localStorage.removeItem('chatapp_user');
    localStorage.removeItem('chatapp_firstName');
    localStorage.removeItem('chatapp_lastName');
    setUser(null);
  };

  if (user) {
    return (
      <Chat
        username={user.username}
        firstName={user.firstName}
        lastName={user.lastName}
        onLogout={handleLogout}
      />
    );
  }
  return <Auth onLogin={handleLogin} />;
}

export default App;
