"use client"

/**
 * Seção Cupons do painel /marketing (só ADMIN): formulário criar/editar +
 * tabela com código, desconto, usos, validade e status. Ações de copiar,
 * editar, ativar/desativar e excluir chamam as server actions de cupons.
 */
import { useEffect, useRef, useState, useTransition } from "react"
import { useActionState } from "react"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { toast } from "sonner"
import { BadgePercent, Copy, Pencil, Power, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  createCoupon,
  updateCoupon,
  toggleCouponEnabled,
  deleteCoupon,
  type CouponActionState,
} from "@/lib/actions/coupons"
import { formatBrl } from "@/lib/payments/coupons"

/** Linha do cupom (tipo estrutural — evita acoplar ao client do Prisma). */
export type CouponRow = {
  id: string
  code: string
  description: string | null
  discountType: "PERCENT" | "FIXED"
  discountValue: number
  minValue: number | null
  maxDiscount: number | null
  validFrom: Date | null
  validUntil: Date | null
  maxUses: number | null
  usedCount: number
  enabled: boolean
}

/** Data/hora local no formato do input datetime-local. */
function toLocalInput(date: Date | null): string {
  if (!date) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function discountLabel(coupon: CouponRow): string {
  if (coupon.discountType === "PERCENT") {
    const value = `${coupon.discountValue}%`.replace(".", ",")
    return coupon.maxDiscount != null
      ? `${value} (teto ${formatBrl(coupon.maxDiscount)})`
      : value
  }
  return formatBrl(coupon.discountValue)
}

function validityLabel(coupon: CouponRow): string {
  const from = coupon.validFrom
    ? format(coupon.validFrom, "dd/MM/yyyy", { locale: ptBR })
    : "—"
  const until = coupon.validUntil
    ? format(coupon.validUntil, "dd/MM/yyyy", { locale: ptBR })
    : "—"
  return `${from} → ${until}`
}

const EMPTY_FORM = {
  code: "",
  description: "",
  discountType: "PERCENT" as "PERCENT" | "FIXED",
  discountValue: "",
  minValue: "",
  maxDiscount: "",
  maxUses: "",
  validFrom: "",
  validUntil: "",
}

export function CouponsSection({ coupons }: { coupons: CouponRow[] }) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const editingIdRef = useRef<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [pendingAction, startAction] = useTransition()

  // O useActionState captura a action no 1º render; o ref decide
  // criar vs. atualizar sem closure obsoleta.
  async function saveCoupon(
    _prev: CouponActionState | null,
    formData: FormData
  ): Promise<CouponActionState> {
    return editingIdRef.current
      ? updateCoupon(_prev, formData)
      : createCoupon(_prev, formData)
  }

  const [state, formAction, pending] = useActionState<
    CouponActionState | null,
    FormData
  >(saveCoupon, null)

  // Reseta o formulário quando a ação do servidor termina com sucesso.
  // Ajuste feito durante a renderização (quando o state da ação muda), o que
  // evita o efeito em cascata de setState síncrono dentro de useEffect.
  const [prevState, setPrevState] = useState<CouponActionState | null>(null)
  if (state !== prevState) {
    setPrevState(state)
    if (state?.success) {
      setEditingId(null)
      setForm(EMPTY_FORM)
    }
  }

  useEffect(() => {
    if (!state) return
    if (state.success) {
      toast.success(state.message)
      // O ref espelha o estado de edição para a action capturada no 1º render.
      editingIdRef.current = null
    } else {
      toast.error(state.message)
    }
  }, [state])

  function startEdit(coupon: CouponRow) {
    setEditingId(coupon.id)
    editingIdRef.current = coupon.id
    setForm({
      code: coupon.code,
      description: coupon.description ?? "",
      discountType: coupon.discountType,
      discountValue: String(coupon.discountValue),
      minValue: coupon.minValue != null ? String(coupon.minValue) : "",
      maxDiscount: coupon.maxDiscount != null ? String(coupon.maxDiscount) : "",
      maxUses: coupon.maxUses != null ? String(coupon.maxUses) : "",
      validFrom: toLocalInput(coupon.validFrom),
      validUntil: toLocalInput(coupon.validUntil),
    })
  }

  function handleToggle(coupon: CouponRow) {
    startAction(async () => {
      const result = await toggleCouponEnabled(coupon.id)
      toast[result.success ? "success" : "error"](result.message)
    })
  }

  function handleDelete(coupon: CouponRow) {
    if (
      !window.confirm(
        `Excluir o cupom ${coupon.code}? Os usos registrados também serão removidos.`
      )
    ) {
      return
    }
    startAction(async () => {
      const result = await deleteCoupon(coupon.id)
      toast[result.success ? "success" : "error"](result.message)
    })
  }

  async function handleCopy(code: string) {
    try {
      await navigator.clipboard.writeText(code)
      toast.success(`Código ${code} copiado`)
    } catch {
      toast.error("Não foi possível copiar o código")
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="flex items-center gap-2">
            <BadgePercent className="h-5 w-5" />
            Cupons de desconto
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <form action={formAction} className="flex flex-col gap-4">
          {editingId && <input type="hidden" name="id" value={editingId} />}

          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>Código *</FieldLabel>
              <Input
                name="code"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="Ex.: BEMVINDO10"
                required
              />
              <p className="text-xs text-muted-foreground">
                Alfanumérico (A-Z, 0-9); salvo em maiúsculas.
              </p>
            </Field>
            <Field>
              <FieldLabel>Descrição</FieldLabel>
              <Input
                name="description"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                placeholder="Ex.: Boas-vindas de novos pacientes"
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Field>
              <FieldLabel>Tipo de desconto *</FieldLabel>
              <select
                name="discountType"
                value={form.discountType}
                onChange={(e) =>
                  setForm({ ...form, discountType: e.target.value as "PERCENT" | "FIXED" })
                }
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                <option value="PERCENT">Percentual (%)</option>
                <option value="FIXED">Valor fixo (R$)</option>
              </select>
            </Field>
            <Field>
              <FieldLabel>
                {form.discountType === "PERCENT" ? "Percentual *" : "Valor (R$) *"}
              </FieldLabel>
              <Input
                name="discountValue"
                type="number"
                min={0}
                step="0.01"
                value={form.discountValue}
                onChange={(e) =>
                  setForm({ ...form, discountValue: e.target.value })
                }
                placeholder={form.discountType === "PERCENT" ? "10" : "50"}
                required
              />
            </Field>
            <Field>
              <FieldLabel>
                {form.discountType === "PERCENT"
                  ? "Teto em R$ (opcional)"
                  : "Compra mínima R$ (opcional)"}
              </FieldLabel>
              <Input
                name={form.discountType === "PERCENT" ? "maxDiscount" : "minValue"}
                type="number"
                min={0}
                step="0.01"
                value={
                  form.discountType === "PERCENT"
                    ? form.maxDiscount
                    : form.minValue
                }
                onChange={(e) =>
                  setForm(
                    form.discountType === "PERCENT"
                      ? { ...form, maxDiscount: e.target.value }
                      : { ...form, minValue: e.target.value }
                  )
                }
                placeholder="0,00"
              />
              {form.discountType === "PERCENT" && (
                <input type="hidden" name="minValue" value={form.minValue} />
              )}
              {form.discountType === "FIXED" && (
                <input type="hidden" name="maxDiscount" value={form.maxDiscount} />
              )}
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Field>
              <FieldLabel>Limite de usos (opcional)</FieldLabel>
              <Input
                name="maxUses"
                type="number"
                min={1}
                step={1}
                value={form.maxUses}
                onChange={(e) => setForm({ ...form, maxUses: e.target.value })}
                placeholder="Vazio = ilimitado"
              />
            </Field>
            <Field>
              <FieldLabel>Válido a partir de</FieldLabel>
              <Input
                name="validFrom"
                type="datetime-local"
                value={form.validFrom}
                onChange={(e) => setForm({ ...form, validFrom: e.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel>Válido até</FieldLabel>
              <Input
                name="validUntil"
                type="datetime-local"
                value={form.validUntil}
                onChange={(e) =>
                  setForm({ ...form, validUntil: e.target.value })
                }
              />
            </Field>
          </div>

          <div className="flex gap-3">
            <Button type="submit" disabled={pending || pendingAction}>
              {editingId ? "Salvar alterações" : "Criar cupom"}
            </Button>
            {editingId && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditingId(null)
                  editingIdRef.current = null
                  setForm(EMPTY_FORM)
                }}
              >
                Cancelar edição
              </Button>
            )}
          </div>
        </form>

        {coupons.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Nenhum cupom ainda. Crie o primeiro acima e vincule-o a uma
            campanha para divulgar o código.
          </div>
        ) : (
          <div className="rounded-lg border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Desconto</TableHead>
                  <TableHead className="hidden md:table-cell">Usos</TableHead>
                  <TableHead className="hidden lg:table-cell">Validade</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {coupons.map((coupon) => (
                  <TableRow key={coupon.id}>
                    <TableCell className="font-mono font-medium">
                      {coupon.code}
                    </TableCell>
                    <TableCell>{discountLabel(coupon)}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      {coupon.usedCount}/{coupon.maxUses ?? "∞"}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {validityLabel(coupon)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={coupon.enabled ? "default" : "outline"}>
                        {coupon.enabled ? "Ativo" : "Inativo"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-8 px-2"
                          title="Copiar código"
                          onClick={() => handleCopy(coupon.code)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-8 px-2"
                          title="Editar"
                          onClick={() => startEdit(coupon)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-8 px-2"
                          title={coupon.enabled ? "Desativar" : "Ativar"}
                          onClick={() => handleToggle(coupon)}
                        >
                          <Power className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-8 px-2 text-destructive"
                          title="Excluir"
                          onClick={() => handleDelete(coupon)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
