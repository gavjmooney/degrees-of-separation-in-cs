"""Curated venue -> subject-area taxonomy for labelling map communities.

Venue strings are dblp journal/booktitle values. Matching: exact name after
normalization (trailing parenthesised track/volume markers stripped), then
regex patterns for journal families. Megajournals that span all of CS are
excluded from labelling entirely.
"""

from __future__ import annotations

import re

EXCLUDED_VENUES = {
    "CoRR",
    "IEEE Access",
    "PLoS ONE",
    "Sci. Rep.",
    "Nature",
    "Science",
    "Proc. Natl. Acad. Sci. USA",
    "Complex.",
    "Heliyon",
    "PeerJ Comput. Sci.",
}

FIELDS: dict[str, list[str]] = {
    "Machine Learning": [
        "NeurIPS", "NIPS", "ICML", "ICLR", "AISTATS", "UAI", "COLT",
        "J. Mach. Learn. Res.", "Mach. Learn.", "Trans. Mach. Learn. Res.",
        "ICLR (Poster)", "ICLR (Workshop)",
    ],
    "Computer Vision": [
        "CVPR", "ICCV", "ECCV", "WACV", "BMVC", "ACCV", "CVPR Workshops",
        "ICCV Workshops", "ECCV Workshops", "IEEE Trans. Pattern Anal. Mach. Intell.",
        "Int. J. Comput. Vis.", "Pattern Recognit.", "Pattern Recognit. Lett.",
        "Comput. Vis. Image Underst.", "Image Vis. Comput.", "IEEE Trans. Image Process.",
        "ICIP", "ICPR",
    ],
    "Natural Language Processing": [
        "ACL", "EMNLP", "NAACL", "NAACL-HLT", "COLING", "EACL", "CoNLL",
        "ACL Findings", "EMNLP Findings", "Comput. Linguistics",
        "Trans. Assoc. Comput. Linguistics", "LREC", "SemEval@ACL", "ACL/IJCNLP",
    ],
    "Speech & Signal Processing": [
        "ICASSP", "Interspeech", "IEEE ACM Trans. Audio Speech Lang. Process.",
        "IEEE Trans. Signal Process.", "Signal Process.", "IEEE Signal Process. Lett.",
        "Speech Commun.", "Digit. Signal Process.", "EURASIP J. Adv. Signal Process.",
        "Comput. Speech Lang.", "ASRU", "SLT",
    ],
    "Artificial Intelligence": [
        "AAAI", "IJCAI", "ECAI", "Artif. Intell.", "J. Artif. Intell. Res.",
        "AAMAS", "Auton. Agents Multi Agent Syst.", "Appl. Intell.",
    ],
    "Data Mining & Information Retrieval": [
        "KDD", "ICDM", "WSDM", "CIKM", "SIGIR", "WWW", "RecSys", "PAKDD", "ECML/PKDD",
        "ACM Trans. Inf. Syst.", "Inf. Process. Manag.", "Data Min. Knowl. Discov.",
        "ACM Trans. Knowl. Discov. Data", "Knowl. Inf. Syst.", "J. Web Semant.",
    ],
    "Databases": [
        "SIGMOD Conference", "VLDB", "Proc. VLDB Endow.", "ICDE", "EDBT", "PODS",
        "ACM Trans. Database Syst.", "IEEE Trans. Knowl. Data Eng.", "VLDB J.",
        "Inf. Syst.", "Distributed Parallel Databases",
    ],
    "Algorithms & Theory": [
        "STOC", "FOCS", "SODA", "ICALP", "STACS", "ESA", "MFCS", "APPROX/RANDOM",
        "Theor. Comput. Sci.", "SIAM J. Comput.", "J. ACM", "Algorithmica",
        "ACM Trans. Algorithms", "Inf. Comput.", "J. Comput. Syst. Sci.",
        "Inf. Process. Lett.", "Theory Comput. Syst.", "ITCS", "CCC",
    ],
    "Discrete Mathematics": [
        "Discret. Math.", "Discret. Appl. Math.", "Electron. J. Comb.",
        "J. Comb. Theory, Ser. A", "J. Comb. Theory, Ser. B", "Eur. J. Comb.",
        "J. Graph Theory", "Graphs Comb.", "SIAM J. Discret. Math.", "Comb.",
        "Comb. Probab. Comput.", "Discuss. Math. Graph Theory", "Ars Comb.",
    ],
    "Cryptography & Security": [
        "CCS", "USENIX Security Symposium", "NDSS", "IEEE Symposium on Security and Privacy",
        "EuroS&P", "ACSAC", "CRYPTO", "EUROCRYPT", "ASIACRYPT", "TCC", "PKC", "CHES",
        "IACR Cryptol. ePrint Arch.", "J. Cryptol.", "IEEE Trans. Inf. Forensics Secur.",
        "Comput. Secur.", "Des. Codes Cryptogr.", "IEEE Trans. Dependable Secur. Comput.",
        "ESORICS", "RAID", "DSN", "J. Inf. Secur. Appl.",
    ],
    "Networking": [
        "SIGCOMM", "INFOCOM", "NSDI", "CoNEXT", "IMC", "Comput. Networks",
        "IEEE/ACM Trans. Netw.", "Comput. Commun.", "Ad Hoc Networks",
        "IEEE Netw.", "J. Netw. Comput. Appl.", "IEEE Trans. Netw. Serv. Manag.",
        "NOMS", "IM", "Wirel. Networks",
    ],
    "Wireless & Communications": [
        "IEEE Trans. Wirel. Commun.", "IEEE Trans. Commun.", "IEEE Commun. Lett.",
        "IEEE Wirel. Commun. Lett.", "GLOBECOM", "ICC", "WCNC", "PIMRC", "VTC Spring",
        "VTC Fall", "IEEE Trans. Veh. Technol.", "IEEE Commun. Mag.", "IEEE Wirel. Commun.",
        "IEEE J. Sel. Areas Commun.", "Phys. Commun.", "IEEE Commun. Surv. Tutorials",
        "IEEE Trans. Cogn. Commun. Netw.", "Veh. Commun.", "IET Commun.",
        "Wirel. Commun. Mob. Comput.", "EURASIP J. Wirel. Commun. Netw.",
    ],
    "IoT & Sensing": [
        "IEEE Internet Things J.", "Sensors", "IEEE Sens. J.", "SenSys", "IPSN",
        "ACM Trans. Sens. Networks", "IEEE Internet Things Mag.", "Internet Things",
        "Pervasive Mob. Comput.",
    ],
    "Computer Systems": [
        "SOSP", "OSDI", "EuroSys", "USENIX ATC", "USENIX Annual Technical Conference",
        "ASPLOS", "FAST", "Middleware", "ACM Trans. Comput. Syst.", "VEE", "SoCC",
        "ACM Trans. Storage", "HotOS",
    ],
    "Hardware & EDA": [
        "ISCA", "MICRO", "HPCA", "DAC", "ICCAD", "DATE", "ASP-DAC", "FPGA", "FCCM",
        "IEEE Trans. Comput. Aided Des. Integr. Circuits Syst.", "IEEE Trans. Very Large Scale Integr. Syst.",
        "ACM Trans. Design Autom. Electr. Syst.", "IEEE Trans. Circuits Syst. I Regul. Pap.",
        "IEEE Trans. Circuits Syst. II Express Briefs", "ISCAS", "Microprocess. Microsystems",
        "IEEE Trans. Computers", "Integr.",
    ],
    "Parallel & Distributed Computing": [
        "SC", "HPDC", "IPDPS", "ICPP", "PPoPP", "Euro-Par", "CCGRID", "CLUSTER",
        "IEEE Trans. Parallel Distributed Syst.", "J. Parallel Distributed Comput.",
        "Parallel Comput.", "Concurr. Comput. Pract. Exp.", "Future Gener. Comput. Syst.",
        "IEEE Trans. Cloud Comput.", "J. Supercomput.", "Distributed Comput.", "PODC", "DISC",
    ],
    "Software Engineering": [
        "ICSE", "ESEC/SIGSOFT FSE", "ASE", "ISSTA", "MSR", "ICSME", "SANER", "ICST",
        "Empir. Softw. Eng.", "IEEE Trans. Software Eng.", "J. Syst. Softw.",
        "Inf. Softw. Technol.", "ACM Trans. Softw. Eng. Methodol.", "Softw. Pract. Exp.",
        "RE", "MODELS", "Softw. Syst. Model.", "Autom. Softw. Eng.",
    ],
    "Programming Languages & Verification": [
        "POPL", "PLDI", "OOPSLA", "ICFP", "Proc. ACM Program. Lang.", "CAV", "TACAS",
        "ACM Trans. Program. Lang. Syst.", "LICS", "CONCUR", "VMCAI", "ESOP", "FM",
        "J. Funct. Program.", "Formal Methods Syst. Des.", "Sci. Comput. Program.",
        "J. Autom. Reason.", "CADE", "IJCAR", "J. Symb. Comput.", "Log. Methods Comput. Sci.",
        "Arch. Formal Proofs", "ACM Trans. Comput. Log.", "Ann. Pure Appl. Log.",
        "J. Log. Comput.",
    ],
    "Human-Computer Interaction": [
        "CHI", "CSCW", "UIST", "IUI", "CHI Extended Abstracts", "DIS",
        "Proc. ACM Hum. Comput. Interact.", "Int. J. Hum. Comput. Stud.",
        "ACM Trans. Comput. Hum. Interact.", "Proc. ACM Interact. Mob. Wearable Ubiquitous Technol.",
        "UbiComp", "Behav. Inf. Technol.", "Interact. Comput.", "MobileHCI", "HRI",
        "Int. J. Hum. Comput. Interact.",
    ],
    "Graphics & Visualization": [
        "ACM Trans. Graph.", "SIGGRAPH", "SIGGRAPH Asia", "Comput. Graph. Forum",
        "IEEE Trans. Vis. Comput. Graph.", "Eurographics", "Comput. Graph.",
        "Vis. Comput.", "Comput. Aided Geom. Des.", "Comput. Aided Des.",
        "Graph. Model.", "I3D", "SCA",
    ],
    "Robotics": [
        "ICRA", "IROS", "IEEE Robotics Autom. Lett.", "Robotics: Science and Systems",
        "Auton. Robots", "IEEE Trans. Robotics", "Robotics Auton. Syst.",
        "J. Field Robotics", "Int. J. Robotics Res.", "IEEE Robotics Autom. Mag.",
        "CoRL", "J. Intell. Robotic Syst.", "Robotica",
    ],
    "Control & Automation": [
        "IEEE Trans. Autom. Control.", "Autom.", "CDC", "ACC", "IEEE Control. Syst. Lett.",
        "Int. J. Control", "Syst. Control. Lett.", "IEEE Trans. Control Syst. Technol.",
        "Eur. J. Control", "Int. J. Robust Nonlinear Control", "IEEE Trans. Control. Netw. Syst.",
        "Nonlinear Anal. Hybrid Syst.", "IEEE CAA J. Autom. Sinica", "J. Frankl. Inst.",
        "ECC", "IFAC-PapersOnLine",
    ],
    "Bioinformatics": [
        "Bioinform.", "BMC Bioinform.", "RECOMB", "J. Comput. Biol.", "PLoS Comput. Biol.",
        "Briefings Bioinform.", "Nucleic Acids Res.", "IEEE ACM Trans. Comput. Biol. Bioinform.",
        "Comput. Biol. Chem.", "J. Bioinform. Comput. Biol.", "BIBM", "Algorithms Mol. Biol.",
    ],
    "Biomedical & Health Informatics": [
        "MICCAI", "Medical Image Anal.", "IEEE Trans. Medical Imaging", "EMBC",
        "J. Biomed. Informatics", "J. Am. Medical Informatics Assoc.",
        "IEEE J. Biomed. Health Informatics", "Comput. Methods Programs Biomed.",
        "Comput. Biol. Medicine", "Artif. Intell. Medicine", "NeuroImage",
        "IEEE Trans. Biomed. Eng.", "Medical Biol. Eng. Comput.", "J. Medical Syst.",
        "Int. J. Medical Informatics", "J. Medical Imaging Health Informatics",
        "Frontiers Neuroinformatics", "J. Neurosci. Methods", "Brain Informatics",
        "ISBI", "Comput. Medical Imaging Graph.",
    ],
    "Remote Sensing & Geoscience": [
        "IEEE Trans. Geosci. Remote. Sens.", "Remote. Sens.", "IGARSS",
        "IEEE Geosci. Remote. Sens. Lett.", "IEEE J. Sel. Top. Appl. Earth Obs. Remote. Sens.",
        "ISPRS J. Photogramm. Remote. Sens.", "Int. J. Appl. Earth Obs. Geoinformation",
        "ISPRS Int. J. Geo Inf.", "Int. J. Geogr. Inf. Sci.", "Comput. Geosci.",
        "Environ. Model. Softw.", "Geoinformatica",
    ],
    "Optimization & Operations Research": [
        "Math. Program.", "Oper. Res.", "Eur. J. Oper. Res.", "SIAM J. Optim.",
        "Comput. Oper. Res.", "Optim. Lett.", "J. Glob. Optim.", "Ann. Oper. Res.",
        "INFORMS J. Comput.", "Math. Oper. Res.", "Optim. Methods Softw.",
        "J. Optim. Theory Appl.", "Comput. Optim. Appl.", "Discret. Optim.",
        "Oper. Res. Lett.", "OR Spectr.", "Networks", "Transp. Sci.",
        "J. Sched.", "Omega", "J. Comb. Optim.",
    ],
    "Numerical & Scientific Computing": [
        "SIAM J. Sci. Comput.", "J. Comput. Phys.", "J. Sci. Comput.",
        "J. Comput. Appl. Math.", "Appl. Math. Comput.", "Math. Comput. Simul.",
        "Numer. Algorithms", "Comput. Phys. Commun.", "SIAM J. Numer. Anal.",
        "Appl. Numer. Math.", "Comput. Math. Appl.", "Numerische Mathematik",
        "Adv. Comput. Math.", "Math. Comput.", "BIT Numer. Math.",
        "Commun. Nonlinear Sci. Numer. Simul.", "Linear Algebra Appl.",
        "SIAM J. Matrix Anal. Appl.", "ACM Trans. Math. Softw.", "Calcolo",
    ],
    "Quantum Computing": [
        "Quantum", "Quantum Inf. Process.", "IEEE Trans. Quantum Eng.",
        "npj Quantum Inf.", "Quantum Inf. Comput.", "ACM Trans. Quantum Comput.",
        "Quantum Sci. Technol.",
    ],
    "Computational Intelligence": [
        "IEEE Trans. Fuzzy Syst.", "Fuzzy Sets Syst.", "IEEE Trans. Evol. Comput.",
        "Evol. Comput.", "GECCO", "CEC", "Appl. Soft Comput.", "Neurocomputing",
        "Neural Networks", "IEEE Trans. Neural Networks Learn. Syst.", "Soft Comput.",
        "Swarm Evol. Comput.", "Expert Syst. Appl.", "Knowl. Based Syst.", "Inf. Sci.",
        "Neural Comput. Appl.", "Int. J. Fuzzy Syst.", "Nat. Comput.", "Memetic Comput.",
        "Neural Process. Lett.", "Int. J. Neural Syst.", "Neural Comput.", "IJCNN",
        "Cogn. Comput.", "Swarm Intell.",
    ],
    "Industrial & Energy Systems": [
        "IEEE Trans. Ind. Informatics", "IEEE Trans. Smart Grid", "IEEE Trans. Ind. Electron.",
        "IEEE Trans. Instrum. Meas.", "IEEE Trans. Syst. Man Cybern. Syst.",
        "IEEE Trans. Intell. Transp. Syst.", "Reliab. Eng. Syst. Saf.",
        "IEEE Syst. J.", "Int. J. Prod. Res.", "Comput. Ind. Eng.", "J. Intell. Manuf.",
        "Robotics Comput. Integr. Manuf.", "IEEE Trans. Autom. Sci. Eng.",
        "Eng. Appl. Artif. Intell.", "Adv. Eng. Informatics",
    ],
    "Multimedia": [
        "ACM Multimedia", "IEEE Trans. Multim.", "ICME", "ICMR",
        "IEEE Trans. Circuits Syst. Video Technol.", "Multim. Tools Appl.",
        "Multim. Syst.", "ACM Trans. Multim. Comput. Commun. Appl.", "MMM",
        "Signal Process. Image Commun.", "J. Vis. Commun. Image Represent.",
    ],
    "Computing Education": [
        "SIGCSE", "ITiCSE", "Comput. Educ.", "IEEE Trans. Educ.", "ICER",
        "Educ. Inf. Technol.", "J. Educ. Comput. Res.", "ACM Trans. Comput. Educ.",
        "Br. J. Educ. Technol.", "Int. J. Artif. Intell. Educ.", "L@S", "FIE",
        "Interact. Learn. Environ.", "Smart Learn. Environ.", "EDM", "LAK",
        "AIED", "Internet High. Educ.", "Comput. Hum. Behav.",
    ],
    "Optical & Photonic Communications": [
        "OFC", "J. Lightw. Technol.", "IEEE Photonics Technol. Lett.", "Opt. Express",
        "J. Opt. Commun. Netw.", "ECOC", "Opt. Switch. Netw.",
    ],
}

# Regex fallbacks for journal families not worth enumerating exhaustively.
PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"Wirel\.|Antennas|Microw\.", re.I), "Wireless & Communications"),
    (re.compile(r"Fuzzy|Neural|Evol\.", re.I), "Computational Intelligence"),
    (re.compile(r"Robot", re.I), "Robotics"),
    (re.compile(r"Secur\.|Cryptogr|Priv\.", re.I), "Cryptography & Security"),
    (re.compile(r"Softw\.", re.I), "Software Engineering"),
    (re.compile(r"Comb\.|Graph Theory", re.I), "Discrete Mathematics"),
    (re.compile(r"Remote Sens|Geosci", re.I), "Remote Sensing & Geoscience"),
    (re.compile(r"Bioinform", re.I), "Bioinformatics"),
    (re.compile(r"Medic|Biomed|Health", re.I), "Biomedical & Health Informatics"),
    (re.compile(r"Quantum", re.I), "Quantum Computing"),
    (re.compile(r"Photonic|Lightw|Opt\. ", re.I), "Optical & Photonic Communications"),
    (re.compile(r"Semant\. Web", re.I), "Data Mining & Information Retrieval"),
    (re.compile(r"Speech|Audio", re.I), "Speech & Signal Processing"),
    (re.compile(r"Educ", re.I), "Computing Education"),
    (re.compile(r"Database|Data Eng", re.I), "Databases"),
    (re.compile(r"Vis\. Comput|Graph\.", re.I), "Graphics & Visualization"),
    (re.compile(r"Hum\. ", re.I), "Human-Computer Interaction"),
    (re.compile(r"Netw", re.I), "Networking"),
    (re.compile(r"Sens", re.I), "IoT & Sensing"),
    (re.compile(r"Control|Autom\.", re.I), "Control & Automation"),
    (re.compile(r"Oper\. Res|Optim", re.I), "Optimization & Operations Research"),
    (re.compile(r"Numer|Comput\. Phys|Appl\. Math", re.I), "Numerical & Scientific Computing"),
    (re.compile(r"Parallel|Distrib|Cloud|Grid", re.I), "Parallel & Distributed Computing"),
    (re.compile(r"Multim", re.I), "Multimedia"),
    (re.compile(r"Image|Vis(ion)?\b", re.I), "Computer Vision"),
    (re.compile(r"Circuits|VLSI|Embed", re.I), "Hardware & EDA"),
    (re.compile(r"Intell\. Transp|Veh\.", re.I), "Industrial & Energy Systems"),
    (re.compile(r"Knowl\.|Min\.", re.I), "Data Mining & Information Retrieval"),
    (re.compile(r"Lang\.|Linguist", re.I), "Natural Language Processing"),
    (re.compile(r"Log\.|Verif", re.I), "Programming Languages & Verification"),
    (re.compile(r"Theor\.|Algorithm", re.I), "Algorithms & Theory"),
    (re.compile(r"Signal", re.I), "Speech & Signal Processing"),
]

# ---- top-level domains: the curated "continents" of the map ----
# Every subject area maps to one of ~14 broad domains that drive colour and
# the always-visible labels; subject areas / venues remain the data-accurate
# subclusters underneath.
DOMAINS: dict[str, str] = {
    "Machine Learning": "AI & Machine Learning",
    "Artificial Intelligence": "AI & Machine Learning",
    "Computational Intelligence": "AI & Machine Learning",
    "Computer Vision": "Vision & Multimedia",
    "Multimedia": "Vision & Multimedia",
    "Natural Language Processing": "Language & Speech",
    "Speech & Signal Processing": "Language & Speech",
    "Algorithms & Theory": "Theory & Algorithms",
    "Discrete Mathematics": "Theory & Algorithms",
    "Quantum Computing": "Theory & Algorithms",
    "Cryptography & Security": "Security & Cryptography",
    "Networking": "Networks & Communications",
    "Wireless & Communications": "Networks & Communications",
    "Optical & Photonic Communications": "Networks & Communications",
    "IoT & Sensing": "Networks & Communications",
    "Databases": "Data & Information",
    "Data Mining & Information Retrieval": "Data & Information",
    "Computer Systems": "Systems & Hardware",
    "Hardware & EDA": "Systems & Hardware",
    "Parallel & Distributed Computing": "Systems & Hardware",
    "Software Engineering": "Software & Languages",
    "Programming Languages & Verification": "Software & Languages",
    "Human-Computer Interaction": "HCI & Education",
    "Computing Education": "HCI & Education",
    "Graphics & Visualization": "Graphics & Visualization",
    "Robotics": "Robotics & Control",
    "Control & Automation": "Robotics & Control",
    "Industrial & Energy Systems": "Robotics & Control",
    "Bioinformatics": "Health & Life Sciences",
    "Biomedical & Health Informatics": "Health & Life Sciences",
    "Remote Sensing & Geoscience": "Computational Science",
    "Optimization & Operations Research": "Computational Science",
    "Numerical & Scientific Computing": "Computational Science",
}

OTHER_DOMAIN = "Interdisciplinary"

DOMAIN_COLORS: dict[str, str] = {
    "AI & Machine Learning": "#e8554e",
    "Vision & Multimedia": "#f29e38",
    "Language & Speech": "#f0d23f",
    "Theory & Algorithms": "#9ad34f",
    "Security & Cryptography": "#45c06b",
    "Networks & Communications": "#3fc1b0",
    "Data & Information": "#41b3e0",
    "Systems & Hardware": "#5479e8",
    "Software & Languages": "#8266e8",
    "HCI & Education": "#b35fd6",
    "Graphics & Visualization": "#e060c0",
    "Robotics & Control": "#e06080",
    "Health & Life Sciences": "#6fcf8f",
    "Computational Science": "#c9a35f",
    # the mixed core should recede rather than glow
    OTHER_DOMAIN: "#566073",
}

_TRACK_SUFFIX = re.compile(r"\s*\(\d+\)$")

_EXACT: dict[str, str] = {}
for _field, _venues in FIELDS.items():
    for _v in _venues:
        _EXACT[_v] = _field


def classify_venue(venue: str) -> str | None:
    """Map a dblp venue string to a subject area, or None if unknown/generic."""
    name = _TRACK_SUFFIX.sub("", venue).strip()
    if name in EXCLUDED_VENUES:
        return None
    field = _EXACT.get(name)
    if field:
        return field
    for pattern, f in PATTERNS:
        if pattern.search(name):
            return f
    return None
