"use client";

import { useState } from "react";
import { Button, ChevronLeftIcon, Field, FilterIcon } from "@auto-world/design-system";
import type { PageWindow } from "../../catalogue/reader";
import { sortLabels, numericFilterLimits, type FilterOptions, type OptionKey, type FlagKey } from "../../catalogue/filters";

function RangeFields({ label, unit, lowerName, upperName, lower, upper, min, max, lowerLabel, upperLabel }: {
  label: string; unit: string; lowerName: string; upperName: string;
  lower?: number; upper?: number; min: number; max: number; lowerLabel?: string; upperLabel?: string;
}) {
  const [from, setFrom] = useState(lower?.toString() ?? "");
  const [to, setTo] = useState(upper?.toString() ?? "");
  return <fieldset className="catalogue-range">
    <legend>{label}</legend>
    <div className="catalogue-range-inputs">
      <Field id={lowerName} name={lowerName} label="Minimum" type="number" inputMode="numeric"
        aria-label={lowerLabel ?? label + " minimum"} placeholder={unit} min={min} max={to ? Math.min(max, Number(to)) : max}
        value={from} onChange={event => setFrom(event.currentTarget.value)} />
      <Field id={upperName} name={upperName} label="Maximum" type="number" inputMode="numeric"
        aria-label={upperLabel ?? label + " maximum"} placeholder={unit} min={from ? Math.max(min, Number(from)) : min} max={max}
        value={to} onChange={event => setTo(event.currentTarget.value)} />
    </div>
  </fieldset>;
}

function matchingLabel(options: readonly string[], value = "") {
  return options.find(option => option.toLowerCase() === value.toLowerCase()) ?? value;
}

function ChoiceField({ name, label, emptyLabel, options, selected }: {
  name: OptionKey; label: string; emptyLabel: string; options: readonly string[]; selected?: string;
}) {
  const current = matchingLabel(options, selected);
  return <div className="catalogue-select-label">
    <label htmlFor={"catalogue-" + name}>{label}</label>
    <select id={"catalogue-" + name} className="site-select" name={name} defaultValue={current}>
      <option value="">{emptyLabel}</option>
      {current && !options.includes(current) && <option>{current}</option>}
      {options.map(value => <option key={value}>{value}</option>)}
    </select>
  </div>;
}

function CheckFilter({ name, label, selected }: {
  name: FlagKey; label: string; selected?: 1;
}) {
  return <label className="catalogue-check-filter">
    <input type="checkbox" name={name} value="1" defaultChecked={selected === 1} />
    {label}
  </label>;
}

export function FilterPanel({ criteria, brands, modelsByBrand, filterOptions, active }: {
  criteria: PageWindow; brands: readonly string[]; modelsByBrand: Readonly<Record<string, readonly string[]>>;
  filterOptions: FilterOptions; active: number;
}) {
  const [brand, setBrand] = useState(() => matchingLabel(brands, criteria.brand));
  const models = Object.hasOwn(modelsByBrand, brand) ? modelsByBrand[brand] ?? [] : [];
  const [model, setModel] = useState(() => matchingLabel(models, criteria.model));

  return <form action="/catalogue" method="get" aria-label="Filtrer les annonces" className="catalogue-filter-form"
    onInvalidCapture={event => {
      if (!(event.target instanceof Element)) return;
      let group = event.target.closest("details");
      while (group && event.currentTarget.contains(group)) {
        group.open = true;
        group = group.parentElement?.closest("details") ?? null;
      }
    }}
    onSubmit={event => {
      for (const input of event.currentTarget.querySelectorAll<HTMLInputElement>('input[type="number"]')) {
        if (input.value) input.value = String(input.valueAsNumber);
      }
    }}>
    {criteria.sort && <input type="hidden" name="sort" value={criteria.sort} />}
    {criteria.q && <input type="hidden" name="q" value={criteria.q} />}
    {criteria.limit !== 20 && <input type="hidden" name="limit" value={criteria.limit} />}
    <div className="catalogue-primary-filters">
      <div className="catalogue-select-label">
        <label htmlFor="catalogue-brand">Marque</label>
        <select id="catalogue-brand" className="site-select" name="brand" value={brand}
          onChange={event => { setBrand(event.currentTarget.value); setModel(""); }}>
          <option value="">Toutes les marques</option>
          {brand && !brands.includes(brand) && <option>{brand}</option>}
          {brands.map(option => <option key={option}>{option}</option>)}
        </select>
      </div>
      <div className="catalogue-select-label">
        <label htmlFor="catalogue-model">Modèle</label>
        <select id="catalogue-model" className="site-select" name="model" value={model}
          disabled={!brand} onChange={event => setModel(event.currentTarget.value)}>
          <option value="">{brand ? "Tous les modèles" : "Choisir une marque"}</option>
          {model && !models.includes(model) && <option>{model}</option>}
          {models.map(option => <option key={option}>{option}</option>)}
        </select>
      </div>
      <RangeFields label="Prix en euros" unit="€" lowerName="priceMin" upperName="priceMax"
        lower={criteria.priceMin} upper={criteria.priceMax} min={0} max={numericFilterLimits.priceMax[1]} />
    </div>
    <details className="catalogue-filters">
      <summary>
        <span className="catalogue-filter-title"><FilterIcon />Filtres {active > 0 && <span>({active})</span>}</span>
        <span className="catalogue-filter-topics">Énergie, boîte, kilométrage…</span>
        <ChevronLeftIcon className="catalogue-filter-chevron" />
      </summary>
      <div className="catalogue-filter-section">
        <h2>Motorisation et carrosserie</h2>
        <div className="catalogue-filter-fields catalogue-technical-fields">
          <ChoiceField name="fuel" label="Énergie" emptyLabel="Toutes les énergies" options={filterOptions.fuel} selected={criteria.fuel} />
          <ChoiceField name="gearbox" label="Boîte de vitesses" emptyLabel="Toutes les boîtes" options={filterOptions.gearbox} selected={criteria.gearbox} />
          <ChoiceField name="body" label="Carrosserie" emptyLabel="Toutes les carrosseries" options={filterOptions.body} selected={criteria.body} />
        </div>
      </div>
      <div className="catalogue-filter-section">
        <h2>Année et kilométrage</h2>
        <div className="catalogue-filter-fields">
          <RangeFields label="Année" unit="Année" lowerName="yearMin" upperName="yearMax"
            lower={criteria.yearMin} upper={criteria.yearMax} min={numericFilterLimits.yearMin[0]} max={numericFilterLimits.yearMax[1]} />
          <RangeFields label="Kilométrage" unit="km" lowerName="kmMin" upperName="kmMax"
            lowerLabel="Kilométrage minimal" upperLabel="Kilométrage maximal"
            lower={criteria.kmMin} upper={criteria.kmMax} min={0} max={numericFilterLimits.kmMax[1]} />
        </div>
      </div>
      <details className="catalogue-refinements" open={Boolean(criteria.color || criteria.upholstery ||
        criteria.doors !== undefined || criteria.seatsMin !== undefined || criteria.seatsMax !== undefined)}>
        <summary>Habitacle et finition <ChevronLeftIcon className="catalogue-filter-chevron" /></summary>
        <div className="catalogue-filter-fields catalogue-interior-fields">
          <ChoiceField name="color" label="Couleur extérieure" emptyLabel="Toutes les couleurs" options={filterOptions.color} selected={criteria.color} />
          <ChoiceField name="upholstery" label="Sellerie" emptyLabel="Toutes les selleries" options={filterOptions.upholstery} selected={criteria.upholstery} />
          <Field id="doors" name="doors" label="Nombre de portes" type="number" inputMode="numeric"
            placeholder="Toutes" min={numericFilterLimits.doors[0]} max={numericFilterLimits.doors[1]} defaultValue={criteria.doors} />
          <RangeFields label="Nombre de places" unit="Places" lowerName="seatsMin" upperName="seatsMax"
            lower={criteria.seatsMin} upper={criteria.seatsMax} min={numericFilterLimits.seatsMin[0]} max={numericFilterLimits.seatsMax[1]} />
        </div>
      </details>
      <div className="catalogue-filter-section">
        <h2>Historique</h2>
        <div className="catalogue-filter-options">
          <CheckFilter name="firstOwner" label="Première main" selected={criteria.firstOwner} />
          <CheckFilter name="inspectionValid" label="Contrôle technique valide" selected={criteria.inspectionValid} />
          <CheckFilter name="serviceBook" label="Carnet d’entretien" selected={criteria.serviceBook} />
        </div>
      </div>
      <div className="catalogue-filter-section">
        <h2>Annonce</h2>
        <div className="catalogue-filter-options">
          <CheckFilter name="hasPrice" label="Prix de vente renseigné" selected={criteria.hasPrice} />
          <CheckFilter name="hasPhotos" label="Avec photos" selected={criteria.hasPhotos} />
        </div>
      </div>
    </details>
    <Button className="catalogue-filter-submit" type="submit">Appliquer les filtres</Button>
  </form>;
}

export function SortResults({ criteria }: { criteria: PageWindow }) {
  return <form className="catalogue-sort" action="/catalogue" method="get" aria-label="Ordre des annonces">
    {Object.entries(criteria).map(([key, value]) => value !== undefined && key !== "after" && key !== "sort"
      && !(key === "limit" && value === 20) && <input key={key} type="hidden" name={key} value={value} />)}
    <label htmlFor="catalogue-sort">Trier par</label>
    <select id="catalogue-sort" className="site-select" name="sort" defaultValue={criteria.sort ?? "default"}
      onChange={event => event.currentTarget.form?.requestSubmit()}>
      {Object.entries(sortLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select>
    <noscript><button type="submit">Appliquer le tri</button></noscript>
  </form>;
}
