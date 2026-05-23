import { createContext, useContext, useId, useState } from "react";

const GreetingContext = createContext("Astro + React");

export function Greeting() {
  const label = useContext(GreetingContext);
  const id = useId();
  const [count] = useState(1);

  return (
    <section aria-labelledby={id}>
      <h1 id={id}>{label}</h1>
      <p>Server rendered React hook count: {count}</p>
    </section>
  );
}
