import type { BudgetBreakdown as BudgetBreakdownType } from "@map-renderer/shared";

export function BudgetBreakdownView({ breakdown, summary }: { breakdown: BudgetBreakdownType; summary?: string | undefined }) {
  return (
    <div className="budget-panel">
      <div className="budget-panel-header">
        <h4>Budget breakdown</h4>
        {breakdown.totalBudget && (
          <span className="budget-total">
            {breakdown.totalBudget}
            {breakdown.currency ? ` ${breakdown.currency}` : ""}
          </span>
        )}
      </div>
      {summary && <p className="budget-summary muted">{summary}</p>}
      <table className="budget-table">
        <thead>
          <tr>
            <th>Category</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {breakdown.items.map((row) => (
            <tr key={`${row.category}-${row.amount}`}>
              <td>
                {row.category}
                {row.note && <div className="budget-note muted">{row.note}</div>}
              </td>
              <td className="budget-amount">{row.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {breakdown.dailyTotals && breakdown.dailyTotals.length > 0 && (
        <div className="budget-daily">
          <strong>Per day</strong>
          <div className="budget-daily-chips">
            {breakdown.dailyTotals.map((d) => (
              <span key={d.day} className="budget-chip">
                Day {d.day}: {d.amount}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
