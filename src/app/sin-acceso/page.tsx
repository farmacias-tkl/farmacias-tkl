import { signOut } from "@/lib/auth";

export const metadata = {
  title: "Sin acceso — Farmacias TKL",
  robots: "noindex, nofollow",
};

export default function SinAccesoPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#1E2D5A",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: "1rem",
        padding: "2rem",
        textAlign: "center",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          width: "56px",
          height: "56px",
          borderRadius: "50%",
          backgroundColor: "#D4632A",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 900,
          fontSize: "17px",
          color: "#fff",
          margin: "0 auto",
        }}
      >
        TKL
      </div>
      <h1 style={{ color: "#fff", fontSize: "20px", fontWeight: 700 }}>Sin acceso</h1>
      <p style={{ color: "rgba(255,255,255,0.6)", fontSize: "14px", maxWidth: "300px" }}>
        Tu rol no tiene permiso para acceder al dashboard ejecutivo.
      </p>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
      >
        <button
          type="submit"
          style={{
            backgroundColor: "transparent",
            border: "1px solid rgba(255,255,255,0.3)",
            borderRadius: "8px",
            color: "rgba(255,255,255,0.8)",
            padding: "0.6rem 1.5rem",
            fontSize: "14px",
            cursor: "pointer",
          }}
        >
          Salir
        </button>
      </form>
    </div>
  );
}
