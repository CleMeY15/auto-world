"use client";

import { useState, type ReactNode } from "react";
import { Button, Field, FilterIcon } from "@auto-world/design-system";
import type { PageWindow } from "../../catalogue/reader";
import { numericFilterLimits } from "../../catalogue/filters";

function RangeFields({ label, unit, lowerName, upperName, lower, upper, min, max, children }: {
  label: string; unit: string; lowerName: string; upperName: string;
  lower?: number; upper?: number; min: number; max: number; children?: ReactNode;
}) {
  const [from, setFrom] = useState(lower?.toString() ?? "");
  const [to, setTo] = useState(upper?.toString() ?? "");
  return <fieldset className="catalogue-range">
    <legend>{label}</legend>
    <Field id={lowerName} name={lowerName} label="Minimum" type="number" inputMode="numeric"
      aria-label={label + " minimum"} placeholder={unit} min={min} max={to ? Math.min(max, Number(to)) : max}
      value={from} onChange={event => setFrom(event.currentTarget.value)} />
    <Field id={upperName} name={upperName} label="Maximum" type="number" inputMode="numeric"
      aria-label={label + " maximum"} placeholder={unit} min={from ? Math.max(min, Number(from)) : min} max={max}
      value={to} onChange={event => setTo(event.currentTarget.value)} />
    {children}
  </fieldset>;
}

export function FilterPanel({ criteria, brands, active }: {
  criteria: PageWindow; brands: readonly string[]; active: number;
}) {
  const requestedBrand = criteria.brand ?? "";
  const matchedBrand = brands.find(brand => brand.toLowerCase() === requestedBrand.toLowerCase());
  return <details className="catalogue-filters">
    <summary><FilterIcon /> Filtres {active > 0 && <span>({active})</span>}</summary>
    <form action="/catalogue" method="get" aria-label="Filtrer les annonces" className="catalogue-filter-form"
      onSubmit={event => {
        for (const input of event.currentTarget.querySelectorAll<HTMLInputElement>('input[type="number"]')) {
          if (input.value) input.value = String(input.valueAsNumber);
        }
      }}>
      {criteria.q && <input type="hidden" name="q" value={criteria.q} />}
      {criteria.limit !== 20 && <input type="hidden" name="limit" value={criteria.limit} />}
      <div className="catalogue-select-label">
        <label htmlFor="catalogue-brand">Marque</label>
        <select id="catalogue-brand" className="site-select" name="brand" defaultValue={matchedBrand ?? requestedBrand}>
          <option value="">Toutes les marques</option>
          {requestedBrand && !matchedBrand && <option>{requestedBrand}</option>}
          {brands.map(brand => <option key={brand}>{brand}</option>)}
        </select>
      </div>
      <RangeFields label="Prix en euros" unit="€" lowerName="priceMin" upperName="priceMax"
        lower={criteria.priceMin} upper={criteria.priceMax} min={0} max={numericFilterLimits.priceMax[1]}>
        <label className="catalogue-price-filter">
          <input type="checkbox" name="hasPrice" value="1" defaultChecked={criteria.hasPrice === 1} />
          Prix de vente renseigné
        </label>
      </RangeFields>
      <RangeFields label="Année" unit="Année" lowerName="yearMin" upperName="yearMax"
        lower={criteria.yearMin} upper={criteria.yearMax} min={numericFilterLimits.yearMin[0]} max={numericFilterLimits.yearMax[1]} />
      <Field id="kmMax" name="kmMax" label="Kilométrage maximal" type="number" inputMode="numeric"
        placeholder="km" min={0} max={numericFilterLimits.kmMax[1]} defaultValue={criteria.kmMax} />
      <Button className="catalogue-filter-submit" type="submit">Appliquer les filtres</Button>
    </form>
  </details>;
}
