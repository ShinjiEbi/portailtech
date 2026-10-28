"""Génère la définition JSON d'un constat de vérification (PDF Word non-formulaire)
à partir de sa mise en page : cases à cocher (carrés 7x7), tableau des mesures,
zones de saisie de l'en-tête. Coordonnées en points PDF, origine en HAUT à gauche
(converties en bas-gauche côté pdf-lib)."""
import sys, json, re, pymupdf as fitz

SYM = {"\uf061": "α", "\uf062": "β", "\uf070": "π", "\uf0a3": "≤", "\uf0b3": "≥", "\uf0b1": "±", "\uf06d": "µ", "\uf067": "γ", "\uf0ae": "→", "\uf0b0": "°"}
def clean(t):
    return "".join(SYM.get(c, c) for c in t)
def words_of(p):
    return [dict(x0=w[0], y0=w[1], x1=w[2], y1=w[3], t=clean(w[4])) for w in p.get_text("words") if clean(w[4]).strip()]

def spans_bold(p):
    out = []
    for b in p.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            for s in l["spans"]:
                if s["text"].strip():
                    out.append((fitz.Rect(s["bbox"]), "Bold" in s["font"]))
    return out

def geom(p):
    H, V, boxes, grey = [], [], [], []
    for dr in p.get_drawings():
        for it in dr["items"]:
            if it[0] != "re":
                continue
            r = it[1]
            if r.height < 1.6 and r.width > 8:
                H.append((r.y0 + r.height / 2, r.x0, r.x1))
            elif r.width < 1.6 and r.height > 5:
                V.append((r.x0 + r.width / 2, r.y0, r.y1))
            elif 6 < r.width < 8.5 and 6 < r.height < 8.5:
                boxes.append((r.x0, r.y0, r.x1, r.y1))
            elif r.width > 15 and r.height > 6 and dr.get("fill") and max(dr["fill"]) < 0.7:
                grey.append(r)
    # dédoublonnage des cases
    ub = []
    for b in boxes:
        if not any(abs(b[0] - c[0]) < 1 and abs(b[1] - c[1]) < 1 for c in ub):
            ub.append(b)
    return H, V, ub, grey

def box_label(b, words, boxes):
    cy = (b[1] + b[3]) / 2
    nxt = min([c[0] for c in boxes if abs((c[1] + c[3]) / 2 - cy) < 3 and c[0] > b[2]] + [b[2] + 200])
    ws = sorted([w for w in words if abs((w["y0"] + w["y1"]) / 2 - cy) < 4 and b[2] - 1 <= w["x0"] < nxt], key=lambda w: w["x0"])
    out, last = [], b[2]
    for w in ws:
        if w["x0"] - last > 8 or len(out) >= 4:
            break
        out.append(w["t"]); last = w["x1"]
    return " ".join(out)

def find(words, text, after=None, y_min=-1, y_max=1e9):
    toks = text.split()
    for i, w in enumerate(words):
        if not (y_min <= w["y0"] <= y_max):
            continue
        if w["t"] == toks[0] and all(i + k < len(words) and words[i + k]["t"] == toks[k] for k in range(len(toks))):
            last = words[i + len(toks) - 1]
            return dict(x0=w["x0"], y0=w["y0"], x1=last["x1"], y1=last["y1"])
    return None

def txt(field_id, page, x, y_top, size=8, w=None, h=None, align="left", label=None, multiline=False):
    f = dict(id=field_id, page=page, x=round(x, 1), y=round(y_top, 1), size=size, align=align)
    if w: f["w"] = round(w, 1)
    if h: f["h"] = round(h, 1)
    if multiline: f["multiline"] = True
    if label: f["label"] = label
    return f

NUC = [("Am", "Am-241"), ("Co", "Co-60"), ("Sr", "Sr-90"), ("Pu", "Pu-239"), ("Cs", "Cs-137")]

def gen(path, tpl_id):
    d = fitz.open(path)
    out = dict(id=tpl_id, pages=d.page_count, header=[], etats=[], sources=[], personnes=[], rows=[], comments=None, everyPage=[])
    cols = None
    for pn, p in enumerate(d):
        words = words_of(p)
        H, V, boxes, grey = geom(p)
        used = set()
        # --- numéro de constat (toutes les pages)
        f = find(words, "Numéro de constat :")
        if f:
            out["everyPage"].append(txt("numero", pn, f["x1"] + 8, f["y0"], size=8))
        # --- en-tête de la page 1
        if pn == 0:
            for lab, fid in [("Délivré à :", "delivre_a"), ("Date de vérification :", "date_verif")]:
                f = find(words, lab)
                if f:
                    out["header"].append(txt(fid, 0, 490, f["y0"] + 0.5, size=8))
            for labs, fid in [(["N° série", "N° Série"], "sn"), (["Identification client", "Identif. client"], "id_client"), (["Localisation"], "localisation")]:
                for lab in labs:
                    f = find(words, lab)
                    if f:
                        out["header"].append(txt(fid, 0, (f["x0"] + f["x1"]) / 2, f["y1"] + 2, size=8, align="center"))
                        break
            # cases d'état : regroupées par en-tête de colonne
            heads = []
            for lab, g in [("Etat en entrée", "entree"), ("Intervention réalisée", "intervention"), ("Etat en sortie", "sortie"), ("JUGEMENT", "jugement")]:
                f = find(words, lab)
                if f: heads.append((f, g))
            top_table = find(words, "MESURES") or find(words, "EQUIPEMENTS")
            ylim = top_table["y0"] if top_table else 300
            hy = (heads[0][0]["y0"] + heads[0][0]["y1"]) / 2 if heads else 0
            vxs = sorted(set(round(v[0], 1) for v in V if v[1] - 1 <= hy <= v[2] + 1))
            bounds = []
            for f_, g in sorted(heads, key=lambda h: h[0]["x0"]):
                cx = (f_["x0"] + f_["x1"]) / 2
                lo = max([v for v in vxs if v < f_["x0"]] or [0]); hi = min([v for v in vxs if v > f_["x1"]] or [1e9])
                bounds.append((lo, hi, g))
            for b in boxes:
                if b[1] < (heads[0][0]["y1"] if heads else 0) or b[1] > ylim:
                    continue
                g = next((gg for a, z, gg in bounds if a <= b[0] < z), None)
                if not g: continue
                used.add(b)
                out["etats"].append(dict(group=g, label=box_label(b, words, boxes), page=0, x=round(b[0], 1), y=round(b[1], 1), s=round(b[2] - b[0], 1)))
            # sources (lignes à puce entre « Liste des équipements » et « INCERTITUDES »)
            a = find(words, "Liste des équipements")
            z = find(words, "INCERTITUDES")
            if a and z:
                lines = {}
                zone = [w for w in words if a["y1"] < (w["y0"] + w["y1"]) / 2 < z["y0"] - 1]
                anchors = sorted((w["y0"] + w["y1"]) / 2 for w in zone if w["t"] == "•")
                for w in zone:
                    cy = (w["y0"] + w["y1"]) / 2
                    k = min(range(len(anchors)), key=lambda i: abs(anchors[i] - cy)) if anchors else round(cy / 3)
                    if anchors and abs(anchors[k] - cy) > 6: continue
                    lines.setdefault(k, []).append(w)
                for k in sorted(lines):
                    ws = sorted(lines[k], key=lambda w: w["x0"])
                    line = " ".join(w["t"] for w in ws)
                    yt = min(w["y0"] for w in ws if w["t"] not in ("•",))
                    # zones : après « n° : » / « n° » et après « Activité … : »
                    num_x = act_x = act_lbl = None
                    num_y = act_y = yt
                    for i, w in enumerate(ws):
                        if w["t"].lower().startswith("n°"):
                            nx = ws[i + 1] if i + 1 < len(ws) and ws[i + 1]["t"].startswith(":") else w
                            num_x = nx["x1"] + 4; num_y = w["y0"]
                        if w["t"].startswith("Activité"):
                            act_y = w["y0"]; act_lbl = w["x0"]
                            j = i
                            while j < len(ws) and not ws[j]["t"].endswith(":"): j += 1
                            if j < len(ws): act_x = ws[j]["x1"] + 4
                    if num_x is None: continue
                    rn = None
                    for sym, full in NUC:
                        if re.search(r"(\d{2,3}\s*%s\b|%s\s*-?\s*\d{2,3}|\b%s\b)" % (sym, sym, sym), line):
                            rn = full; break
                    typs = re.findall(r"\bS\s?(\d{1,2})\b", line)
                    slot = dict(id=f"src{len(out['sources']) + 1}", label=re.sub(r"\s+", " ", line.replace("•", "")).strip(),
                                rn=rn, types=["S" + t for t in typs], page=0,
                                num=dict(x=round(num_x, 1), y=round(num_y, 1), w=round((act_lbl if act_x else 575) - num_x - 3, 1)), act=(dict(x=round(act_x, 1), y=round(act_y, 1)) if act_x else None))
                    out["sources"].append(slot)
            # exécutant / contrôleur
            for lab, pid in [("EXECUTANT", "exec"), ("CONTROLEUR", "ct")]:
                f = next((w for w in words if w["t"].startswith(lab)), None)
                if not f: continue
                cy = (f["y0"] + f["y1"]) / 2
                same = sorted([w for w in words if abs((w["y0"] + w["y1"]) / 2 - cy) < 3], key=lambda w: w["x0"])
                nom = next((w for w in same if w["t"] == "Nom"), None)
                sig = next((w for w in same if w["t"] == "Signature"), None)
                if nom:
                    out["personnes"].append(dict(id=pid, page=0, nom=dict(x=round(nom["x1"] + 12, 1), y=round(f["y0"], 1)),
                                                 sig=(dict(x=round(sig["x1"] + 12, 1), y=round(f["y0"] - 6, 1)) if sig else None)))
        # --- tableau des mesures
        hdr = {}
        for lab, k in [("Tolérance", "tol"), ("Valeur avant", "avant"), ("Valeur après", "apres"), ("Observation", "obs")]:
            f = find(words, lab)
            if f: hdr[k] = f
        if len(hdr) == 4:
            vx = sorted(set(round(v[0], 1) for v in V if v[1] < hdr["tol"]["y0"] + 2 < v[2]))
            def left_of(x): return max([v for v in vx if v < x] or [x - 40])
            cols = dict(tol=left_of(hdr["tol"]["x0"]), avant=left_of(hdr["avant"]["x0"]), apres=left_of(hdr["apres"]["x0"]),
                        obs=left_of(hdr["obs"]["x0"]), end=max(vx), start=min(vx))
            hb = max(w["y1"] for w in words if hdr["tol"]["y0"] - 8 < w["y0"] < hdr["tol"]["y1"] + 2)
            table_top = min(h[0] for h in H if h[0] > hb - 1)
        elif cols:
            table_top = min(h[0] for h in H if h[0] > 70 and h[1] < cols["avant"] + 5 and h[2] > cols["apres"] - 5)
        else:
            continue
        com = find(words, "COMMENTAIRES :") or find(words, "COMMENTAIRES")
        table_bot = com["y0"] if com else 792
        midA = (cols["avant"] + cols["apres"]) / 2
        seps = sorted(set(round(h[0], 1) for h in H if h[1] <= midA <= h[2] and table_top - 1 <= h[0] <= table_bot))
        merged = []
        for y in seps:
            if not merged or y - merged[-1] > 2.5: merged.append(y)
        def col_of(x):
            if x < cols["tol"]: return "op"
            if x < cols["avant"]: return "tol"
            if x < cols["apres"]: return "avant"
            if x < cols["obs"]: return "apres"
            return "obs"
        bolds = spans_bold(p)
        for y0, y1 in zip(merged, merged[1:]):
            if y1 - y0 < 5: continue
            bw = [w for w in words if y0 < (w["y0"] + w["y1"]) / 2 < y1 and cols["start"] - 2 <= w["x0"] < cols["end"]]
            bb = [b for b in boxes if y0 < (b[1] + b[3]) / 2 < y1 and b not in used]
            if not bw and not bb: continue
            mid = (y0 + y1) / 2
            split = any(abs(v[0] - cols["tol"]) < 2 and v[1] <= mid <= v[2] for v in V)
            boxes_by = {}
            box_words = set()
            for b in bb:
                c = col_of(b[0])
                lab = box_label(b, words, boxes)
                for w in bw:
                    if b[2] - 1 <= w["x0"] and abs((w["y0"] + w["y1"]) / 2 - (b[1] + b[3]) / 2) < 4 and w["t"] in lab.split():
                        box_words.add(id(w))
                boxes_by.setdefault(c, []).append(dict(v=lab or "X", x=round(b[0], 1), y=round(b[1], 1), s=round(b[2] - b[0], 1)))
            by = {}
            def reading(ws):
                ws = sorted(ws, key=lambda w: (w["y0"] + w["y1"]) / 2)
                lines_, cur = [], []
                for w in ws:
                    if cur and (w["y0"] + w["y1"]) / 2 - (cur[-1]["y0"] + cur[-1]["y1"]) / 2 > 4.5:
                        lines_.append(cur); cur = []
                    cur.append(w)
                if cur: lines_.append(cur)
                return [w for l in lines_ for w in sorted(l, key=lambda w: w["x0"])]
            for w in reading(bw):
                if id(w) in box_words: continue
                by.setdefault(col_of((w["x0"] + w["x1"]) / 2 if w["x1"] - w["x0"] < 60 else w["x0"]), []).append(w["t"])
            label = " ".join(by.get("op", []))
            if not split and not bb:
                isbold = any(r.intersects(fitz.Rect(cols["start"], y0, cols["end"], y1)) and bo for r, bo in bolds)
                out["rows"].append(dict(kind="titre", page=pn, label=label + (" " + " ".join(by.get("tol", []) + by.get("avant", [])) if by.get("tol") or by.get("avant") else ""), bold=isbold))
                continue
            if set(boxes_by) == {"tol"} and re.match(r"^\d", label):
                out["rows"].append(dict(kind="titre", page=pn, label=label, bold=True, choice=boxes_by["tol"]))
                continue
            row = dict(kind="mesure", page=pn, y0=round(y0, 1), y1=round(y1, 1), label=label, tol=" ".join(by.get("tol", [])))
            if "tol" in boxes_by: row["tolChoice"] = boxes_by["tol"]
            for c in ("avant", "apres"):
                cx0 = cols[c]; cx1 = cols["apres"] if c == "avant" else cols["obs"]
                if c in boxes_by and [o["v"] for o in boxes_by[c]] == ["SO"]:
                    row[c] = dict(type="textso", so=boxes_by[c][0], x=round(cx0 + 2, 1), w=round(boxes_by[c][0]["x"] - cx0 - 6, 1), y0=round(y0, 1), y1=round(y1, 1))
                elif c in boxes_by:
                    row[c] = dict(type="choice", options=boxes_by[c])
                elif any(g.x0 <= (cx0 + cx1) / 2 <= g.x1 and g.y0 <= mid <= g.y1 for g in grey):
                    row[c] = None
                elif by.get(c):
                    row[c] = None  # cellule pré-imprimée
                else:
                    row[c] = dict(type="text", x=round(cx0 + 2, 1), w=round(cx1 - cx0 - 4, 1), y0=round(y0, 1), y1=round(y1, 1))
            ow = [w for w in bw if col_of(w["x0"]) == "obs"]
            subs = []
            for key in ("Nom", "Visa", "Date"):
                w = next((w for w in ow if w["t"].startswith(key)), None)
                if w:
                    nx = next((v for v in ow if v["x0"] >= w["x1"] - 0.5 and abs(v["y0"] - w["y0"]) < 2 and v["t"] == ":"), w)
                    subs.append(dict(id=key.lower(), x=round(nx["x1"] + 3, 1), y=round(w["y0"], 1)))
            if subs:
                row["obsFields"] = subs
            else:
                row["obs"] = dict(type="text", x=round(cols["obs"] + 2, 1), w=round(cols["end"] - cols["obs"] - 4, 1), y0=round(y0, 1), y1=round(y1, 1))
            out["rows"].append(row)
        if com:
            tops = sorted(h[0] for h in H if h[0] > com["y1"] and h[2] - h[1] > 300)
            if tops:
                bot = tops[-1] if len(tops) > 1 else 760
                out["comments"] = dict(page=pn, x=round(com["x0"] - 4, 1), y=round(tops[0] + 4, 1), w=500, h=round(bot - tops[0] - 8, 1), size=9)
    # libellés des sous-lignes de groupe (α Act. S1/S2/S3…) : propage le préfixe du groupe
    rows = out["rows"]
    orig = [r["label"] for r in rows]
    for i, r in enumerate(rows):
        toks = orig[i].split()
        if r["kind"] != "mesure" or len(toks) < 2: continue
        last = toks[-1]
        if not re.fullmatch(r"[A-Z]\d", last): continue
        pre = " ".join(toks[:-1])
        for j in (i - 1, i + 1):
            if 0 <= j < len(rows) and rows[j]["kind"] == "mesure" and re.fullmatch(r"[A-Z]\d", orig[j].strip()):
                rows[j]["label"] = pre + " " + orig[j].strip()
    return out

if __name__ == "__main__":
    res = gen(sys.argv[1], sys.argv[2])
    json.dump(res, open(sys.argv[3], "w"), ensure_ascii=False, indent=1)
    print(sys.argv[2], "pages", res["pages"], "etats", len(res["etats"]), "sources", len(res["sources"]),
          "rows", len(res["rows"]), "pers", len(res["personnes"]), "everyPage", len(res["everyPage"]), "header", [h["id"] for h in res["header"]], "comments", bool(res["comments"]))
