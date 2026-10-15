const form = document.querySelector("#loginForm");
form.addEventListener("submit", async event => {
  event.preventDefault();
  const button = form.querySelector("button");
  const error = document.querySelector("#loginError");
  button.disabled = true;
  error.textContent = "";
  try {
    const response = await fetch("/stock8-7/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: document.querySelector("#password").value })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "접속에 실패했습니다.");
    location.replace("/stock8-7/");
  } catch (failure) { error.textContent = failure.message; }
  finally { button.disabled = false; }
});
