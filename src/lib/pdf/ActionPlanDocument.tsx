import React from "react";
import {
  Document, Page, View, Text, Image, StyleSheet, Font,
} from "@react-pdf/renderer";
import type { TemplateSection } from "@/lib/action-plan-templates";

const NAVY   = "#1e3a8a";
const ORANGE = "#F59E0B";
const GRAY   = "#6b7280";
const LIGHT  = "#f3f4f6";

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    color: "#111827",
    padding: 40,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
    paddingBottom: 12,
    borderBottomWidth: 2,
    borderBottomColor: NAVY,
  },
  logo: { width: 120, height: 36, objectFit: "contain" },
  headerRight: { alignItems: "flex-end" },
  headerTitle: { fontSize: 13, fontFamily: "Helvetica-Bold", color: NAVY },
  headerSub: { fontSize: 8, color: GRAY, marginTop: 2 },

  infoGrid: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },
  infoBox: {
    flex: 1,
    backgroundColor: LIGHT,
    borderRadius: 4,
    padding: 8,
  },
  infoLabel: { fontSize: 7, color: GRAY, marginBottom: 2, textTransform: "uppercase" },
  infoValue: { fontSize: 9, fontFamily: "Helvetica-Bold", color: "#111827" },

  sectionTitle: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: NAVY,
    backgroundColor: "#dbeafe",
    padding: "4 6",
    marginBottom: 0,
  },
  table: { marginBottom: 10, borderWidth: 1, borderColor: "#d1d5db", borderRadius: 2 },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  tableRowLast: { flexDirection: "row" },
  tableCell: { flex: 1, padding: "5 6", fontSize: 8.5 },
  tableCellNarrow: { width: 48, padding: "5 6", fontSize: 8.5, textAlign: "center" },
  tableHead: {
    flexDirection: "row",
    backgroundColor: NAVY,
    padding: "3 6",
  },
  tableHeadCell: { flex: 1, fontSize: 7.5, color: "white", fontFamily: "Helvetica-Bold" },
  tableHeadCellNarrow: {
    width: 48, fontSize: 7.5, color: "white",
    fontFamily: "Helvetica-Bold", textAlign: "center",
  },

  scoreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
    marginTop: 4,
  },
  scoreLabel: { fontSize: 8.5, color: GRAY, marginRight: 4 },
  scoreBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
  },

  sectionLabel: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    color: NAVY,
    marginBottom: 4,
    marginTop: 10,
  },
  textBlock: {
    fontSize: 8.5,
    color: "#374151",
    backgroundColor: LIGHT,
    padding: 8,
    borderRadius: 4,
    lineHeight: 1.5,
    marginBottom: 4,
  },

  signaturesSection: {
    marginTop: 24,
    flexDirection: "row",
    gap: 16,
  },
  signatureBox: {
    flex: 1,
    borderTopWidth: 1,
    borderTopColor: "#9ca3af",
    paddingTop: 6,
  },
  signatureLabel: { fontSize: 7.5, color: GRAY },

  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingTop: 6,
  },
  footerText: { fontSize: 7, color: GRAY },
});

function scoreStyle(score: string) {
  if (score === "EXCELENTE") return { backgroundColor: "#d1fae5", color: "#065f46" };
  if (score === "BUENO")     return { backgroundColor: "#fef3c7", color: "#92400e" };
  return { backgroundColor: "#fee2e2", color: "#991b1b" };
}

function scoreLabel(score: string) {
  if (score === "EXCELENTE")      return "Excelente";
  if (score === "BUENO")          return "Bueno";
  if (score === "NECESITA_MEJORAR") return "Necesita mejorar";
  return score;
}

interface Props {
  logoBase64: string;
  employeeName: string;
  branchName: string;
  encargado: string;
  planDate: string;
  deadline: string;
  reason: string;
  requiredActions: string;
  sections: TemplateSection[];
  formData: Record<string, "SI" | "NO">;
  generalScore: string;
  improvementPlan?: string | null;
  nextReview?: string | null;
}

export default function ActionPlanDocument({
  logoBase64,
  employeeName,
  branchName,
  encargado,
  planDate,
  deadline,
  reason,
  requiredActions,
  sections,
  formData,
  generalScore,
  improvementPlan,
  nextReview,
}: Props) {
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });

  return (
    <Document>
      <Page size="A4" style={styles.page}>

        {/* Header */}
        <View style={styles.header}>
          <Image src={`data:image/jpeg;base64,${logoBase64}`} style={styles.logo} />
          <View style={styles.headerRight}>
            <Text style={styles.headerTitle}>Plan de Acción</Text>
            <Text style={styles.headerSub}>Evaluación de desempeño operativo</Text>
          </View>
        </View>

        {/* Info grid */}
        <View style={styles.infoGrid}>
          <View style={styles.infoBox}>
            <Text style={styles.infoLabel}>Empleado</Text>
            <Text style={styles.infoValue}>{employeeName}</Text>
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.infoLabel}>Sucursal</Text>
            <Text style={styles.infoValue}>{branchName}</Text>
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.infoLabel}>Encargado</Text>
            <Text style={styles.infoValue}>{encargado}</Text>
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.infoLabel}>Fecha</Text>
            <Text style={styles.infoValue}>{fmtDate(planDate)}</Text>
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.infoLabel}>Plazo</Text>
            <Text style={styles.infoValue}>{fmtDate(deadline)}</Text>
          </View>
        </View>

        {/* Motivo */}
        <Text style={styles.sectionLabel}>Motivo del plan de acción</Text>
        <Text style={styles.textBlock}>{reason}</Text>

        {/* Acciones requeridas */}
        <Text style={styles.sectionLabel}>Acciones requeridas</Text>
        <Text style={styles.textBlock}>{requiredActions}</Text>

        {/* Evaluation sections */}
        {sections.map(section => (
          <View key={section.id} style={styles.table}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <View style={styles.tableHead}>
              <Text style={styles.tableHeadCell}>Criterio</Text>
              <Text style={styles.tableHeadCellNarrow}>Cumple</Text>
            </View>
            {section.items.map((item, idx) => {
              const isLast = idx === section.items.length - 1;
              const value  = formData[item.id] ?? "—";
              return (
                <View key={item.id} style={isLast ? styles.tableRowLast : styles.tableRow}>
                  <Text style={styles.tableCell}>{item.label}</Text>
                  <Text style={[
                    styles.tableCellNarrow,
                    { color: value === "SI" ? "#065f46" : value === "NO" ? "#991b1b" : GRAY,
                      fontFamily: "Helvetica-Bold" },
                  ]}>{value}</Text>
                </View>
              );
            })}
          </View>
        ))}

        {/* General score */}
        <View style={styles.scoreRow}>
          <Text style={styles.scoreLabel}>Calificación general:</Text>
          <Text style={[styles.scoreBadge, scoreStyle(generalScore)]}>
            {scoreLabel(generalScore)}
          </Text>
        </View>

        {/* Improvement plan */}
        {improvementPlan && (
          <>
            <Text style={styles.sectionLabel}>Plan de mejora</Text>
            <Text style={styles.textBlock}>{improvementPlan}</Text>
          </>
        )}

        {/* Next review */}
        {nextReview && (
          <Text style={{ fontSize: 8.5, color: GRAY, marginBottom: 12 }}>
            Próxima revisión: {fmtDate(nextReview)}
          </Text>
        )}

        {/* Signatures */}
        <View style={styles.signaturesSection}>
          <View style={styles.signatureBox}>
            <Text style={styles.signatureLabel}>Firma del empleado</Text>
          </View>
          <View style={styles.signatureBox}>
            <Text style={styles.signatureLabel}>Firma del encargado</Text>
          </View>
          <View style={styles.signatureBox}>
            <Text style={styles.signatureLabel}>Firma supervisor / RRHH</Text>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>Farmacias TKL — Documento interno confidencial</Text>
          <Text style={styles.footerText} render={({ pageNumber, totalPages }) =>
            `Página ${pageNumber} de ${totalPages}`
          } />
        </View>

      </Page>
    </Document>
  );
}
