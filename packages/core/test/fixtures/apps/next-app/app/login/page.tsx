export default function Login() {
  return (
    <form>
      <input data-testid="username" />
      <input data-testid="password" type="password" />
      <button data-testid="login">Sign in</button>
    </form>
  );
}
