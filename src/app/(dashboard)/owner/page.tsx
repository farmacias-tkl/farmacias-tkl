import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canAccessOwnerPanel } from "@/lib/permissions";
import { ShieldCheck } from "lucide-react";

const CARDS = [
  {
    href:        "/owner/accesos",
    icon:        ShieldCheck,
    title:       "Accesos al Dashboard Ejecutivo",
    description: "Otorgar o revocar acceso al modulo ejecutivo a usuarios del sistema.",
    color:       "bg-amber-50 text-amber-700",
  },
];

export default async function OwnerPanelPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canAccessOwnerPanel(session.user)) redirect("/sin-acceso");

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Panel Direccion</h2>
        <p className="text-sm text-gray-500 mt-0.5">Configuracion exclusiva del OWNER. Acceso a modulos sensibles.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map(card => {
          const Icon = card.icon;
          return (
            <Link key={card.href} href={card.href}
              className="card p-5 flex items-start gap-4 hover:shadow-md transition-shadow group">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${card.color}`}>
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                  {card.title}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">{card.description}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
