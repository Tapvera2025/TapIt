/**
 * Vocabulary for the rule-based resume parser.
 *
 * These lists tell a person's name from a job title, a company from a city and
 * a degree from an ordinary word. They are deliberately broad rather than
 * complete: every decision that uses them also looks at layout and position,
 * so an unknown company or city still parses — it just carries less weight.
 */

function words(list: string): ReadonlySet<string> {
  return new Set(list.split(/[|\n]/).map((word) => word.trim().toLowerCase()).filter(Boolean));
}

/** Lines that title the document rather than name the person. */
export const DOCUMENT_TITLES = words(`
  resume|résumé|resumé|curriculum vitae|curriculum-vitae|cv|c.v.|c v|bio-data|biodata|bio data|profile|
  my resume|resume of|candidate profile|career profile|personal profile|personal resume|professional resume|
  job application|application for the post of|covering letter|cover letter
`);

export const HONORIFICS = words('mr|mrs|ms|miss|mx|dr|er|prof|shri|sri|smt|kumari|kum|adv|capt|col|lt|maj|ca|cs|cma');

/** Post-nominal letters that follow a name: "Emily Chen, PMP". */
export const CREDENTIALS = words(`
  pmp|cfa|cpa|ca|aca|fca|acca|cma|cs|frm|cfp|cisa|cism|cissp|csm|cspo|phr|sphr|shrm-cp|shrm-scp|pe|p.e.|rn|
  mba|phd|ph.d|ph.d.|md|m.d.|msc|bsc|ms|be|me|btech|b.tech|mtech|m.tech|llb|ll.b|esq|esq.|jr|jr.|sr|sr.|ii|iii|iv|
  mbbs|bds|bams|bhms|dnb|mch|frcs|mrcp|icwa|prince2|itil|pgdm|mcom|bcom|ccna|ccnp|aws|rhce
`);

/** Lower-case words that may sit inside a name: "Ana de la Cruz", "Ahmad bin Ismail". */
export const NAME_PARTICLES = words('de|da|das|del|della|der|di|dos|du|la|le|van|von|bin|binti|bint|al|el|ibn|ben|ter|ten|y|e|ul|ud');

/** Words that never belong to a person's name line. */
export const NON_NAME_WORDS = words(`
  summary|objective|experience|experiences|education|educational|skills|skill|projects|project|contact|contacts|
  profile|career|personal|details|detail|information|declaration|references|reference|address|mobile|phone|email|
  e-mail|mail|linkedin|github|portfolio|website|languages|language|hobbies|interests|achievements|awards|
  certifications|certification|certificates|training|trainings|internship|internships|qualification|qualifications|
  academic|academics|employment|history|work|professional|technical|key|core|competencies|expertise|strengths|
  responsibilities|roles|role|page|date|birth|place|nationality|gender|marital|status|religion|father|mother|
  dob|tel|fax|cell|whatsapp|street|road|nagar|colony|sector|apartment|apartments|flat|floor|house|near|opp|
  district|pin|pincode|state|city|country|india|resume|curriculum|vitae|biodata|the|and|of|for|with|to|in|at|on|
  an|my|seeking|looking|years|year|months|present|current|company|limited|ltd|pvt|inc|llc|corporation|university|
  college|institute|school|bank|group|technologies|solutions|services|private|public|team|department|
  objective|overview|highlights|accomplishments|activities|volunteer|extracurricular|curricular|positions|tools|
  software|hardware|knowledge|proficiency|signature|thanking|yours|sincerely|regards|available|immediately|
  notice|period|ctc|salary|expected|current|location|relocate|visa|passport|call|twitter|behance|dribbble|kaggle|
  leetcode|medium|blog|download|view|click|here|more|link|links|online|website|portfolio|languages|english|hindi
`);

/** The head nouns of job titles. A line that ends in one is almost never a name. */
export const ROLE_NOUNS = words(`
  engineer|engineers|developer|developers|programmer|architect|manager|lead|head|director|officer|executive|analyst|
  consultant|specialist|associate|assistant|intern|trainee|apprentice|designer|administrator|admin|coordinator|
  supervisor|technician|operator|scientist|researcher|accountant|auditor|advisor|adviser|agent|representative|
  clerk|cashier|teller|nurse|teacher|tutor|lecturer|professor|instructor|faculty|trainer|recruiter|generalist|
  partner|founder|co-founder|cofounder|owner|president|vp|ceo|cto|cfo|coo|cmo|chro|cio|chairman|fellow|volunteer|
  editor|writer|copywriter|journalist|reporter|photographer|artist|animator|illustrator|producer|strategist|
  planner|buyer|merchandiser|controller|estimator|surveyor|draftsman|draughtsman|inspector|chemist|pharmacist|
  therapist|counselor|counsellor|psychologist|physician|surgeon|dentist|attorney|lawyer|advocate|paralegal|
  secretary|receptionist|telecaller|tele-caller|caller|telesales|salesman|salesperson|marketer|steward|stewardess|
  chef|cook|driver|electrician|plumber|mechanic|welder|fitter|machinist|foreman|storekeeper|guard|attendant|
  sde|swe|sre|qa|hrbp|bde|bdm|asm|tsm|zsm|rsm|dse|cre|cse|pm|ba|tl|am|dgm|agm|gm|avp|svp|evp|md|
  student|graduate|fresher|undergraduate|postgraduate|scholar|contributor|ambassador|member|expert|evangelist|
  champion|leader|principal|staff|tester|reviewer|investigator|manager-|specialist-|bdr|sdr|ae
`);

/** Words that qualify a role noun: "Senior Software …", "Relationship …". */
export const ROLE_MODIFIERS = words(`
  senior|sr|sr.|junior|jr|jr.|principal|staff|chief|deputy|associate|assistant|trainee|lead|head|global|regional|
  zonal|area|territory|branch|key|account|accounts|relationship|business|development|technical|software|data|
  product|project|program|programme|operations|operation|quality|customer|support|service|services|sales|marketing|
  human|resources|resource|hr|finance|financial|credit|risk|legal|compliance|field|site|plant|production|
  maintenance|store|inventory|logistics|supply|chain|procurement|purchase|content|digital|social|media|graphic|
  ui|ux|ui/ux|frontend|front-end|backend|back-end|full|stack|full-stack|fullstack|mobile|web|cloud|devops|network|
  system|systems|database|security|cyber|machine|learning|ml|ai|research|test|testing|automation|embedded|
  hardware|electrical|mechanical|civil|chemical|design|process|mis|payroll|talent|acquisition|recruitment|front|
  office|desk|call|centre|center|inside|outside|reliability|site|engineering|solutions|solution|delivery|
  implementation|presales|pre-sales|onboarding|seo|sem|ppc|brand|growth|performance|campaign|events|training|
  learning|clinical|medical|laboratory|lab|teaching|management|managing|executive|general|vice|creative|art|
  visual|motion|interaction|frontend-|devsecops|platform|infrastructure|it|qa/qc|qc|safety|hse|ehs|tax|audit|
  treasury|investment|equity|wealth|portfolio|insurance|loan|loans|collections|retail|corporate|commercial|
  operations-|graduate|summer|winter|research-|teaching-|part-time|full-time|freelance|contract|visiting
`);

/** Company-name endings and words that mark an organisation. */
export const COMPANY_MARKERS = words(`
  ltd|ltd.|limited|pvt|pvt.|private|inc|inc.|incorporated|llc|llp|plc|corp|corp.|corporation|co|co.|company|gmbh|ag|
  sa|bv|nv|pte|pty|technologies|technology|tech|solutions|services|systems|software|softwares|labs|lab|consulting|
  consultants|consultancy|infotech|infosystems|infosys|global|group|holdings|industries|enterprises|international|
  ventures|studio|studios|networks|communications|telecom|bank|finance|financial|finserv|capital|insurance|
  assurance|securities|motors|pharma|pharmaceuticals|healthcare|hospital|hospitals|clinic|foundation|trust|agency|
  media|foods|retail|logistics|airlines|airways|energy|power|steel|cement|textiles|chemicals|automotive|
  constructions|construction|builders|hypermarket|supermarket|mart|stores|fashion|apparel|exports|traders|trading|
  mills|works|manufacturing|platforms|digital|analytics|ai|cloud|payments|fintech|bpo|kpo|outsourcing|realty|
  infrastructure|infra|projects|engineers|associates|partners|advisors|advisory|llp.|ngo|society|council|ministry|
  government|govt|department|authority|board|corporation.|university|college|institute|school|academy|hotel|
  hotels|resorts|restaurant|cafe|bakery|brewery|distillery|electronics|devices|instruments|semiconductors|
  biotech|biosciences|life|sciences|wellness|education|edtech|learning|publishing|press|news|broadcasting|
  entertainment|productions|films|events|marketing|advertising|creatives|designs|interiors|architects
`);

/** Well-known employers, in lower case, for entries that carry no suffix ("Razorpay", "TCS"). */
export const KNOWN_COMPANIES = words(`
  tcs|tata consultancy services|infosys|wipro|hcl|hcltech|hcl technologies|tech mahindra|cognizant|accenture|
  capgemini|ibm|deloitte|deloitte india|pwc|kpmg|ey|ernst & young|genpact|mphasis|mindtree|ltimindtree|lti|l&t|
  larsen & toubro|persistent|persistent systems|zensar|hexaware|cyient|sonata software|birlasoft|coforge|
  mu sigma|fractal|fractal analytics|tiger analytics|latentview|amazon|amazon india|aws|microsoft|google|alphabet|
  meta|facebook|apple|netflix|adobe|oracle|sap|salesforce|intel|nvidia|qualcomm|cisco|vmware|dell|hp|hpe|uber|ola|
  swiggy|zomato|flipkart|myntra|paytm|phonepe|razorpay|cred|zerodha|groww|byju's|byjus|unacademy|vedantu|
  upgrad|freshworks|zoho|zoho corporation|meesho|nykaa|dream11|inmobi|sharechat|oyo|makemytrip|goibibo|cleartrip|
  policybazaar|bigbasket|dunzo|delhivery|blinkit|zepto|lenskart|urban company|practo|pharmeasy|tata 1mg|hdfc|
  hdfc bank|hdfc life|icici|icici bank|icici prudential|sbi|state bank of india|axis bank|kotak|
  kotak mahindra bank|yes bank|indusind bank|bajaj|bajaj finserv|bajaj finance|bajaj auto|reliance|
  reliance industries|reliance retail|jio|reliance jio|jio platforms|airtel|bharti airtel|vodafone idea|
  tata motors|tata steel|tata power|tata communications|titan|mahindra|mahindra & mahindra|maruti suzuki|
  hero motocorp|tvs motor|ashok leyland|hindustan unilever|hul|itc|nestle|p&g|procter & gamble|asian paints|dabur|
  marico|godrej|britannia|amul|coca-cola|pepsico|lulu|lulu group|al futtaim|emaar|teleperformance|concentrix|
  just dial|justdial|naukri|info edge|stripe|twilio|shopify|atlassian|thoughtworks|goldman sachs|jp morgan|
  jpmorgan|jpmorgan chase|morgan stanley|citi|citibank|hsbc|barclays|deutsche bank|standard chartered|
  american express|amex|visa|mastercard|walmart|walmart labs|target|ikea|bosch|siemens|honeywell|ge|abb|
  schneider electric|philips|samsung|lg|sony|muthoot|muthoot finance|manappuram|ola electric|mahindra finance|
  linkedin|twitter|x|spotify|airbnb|booking.com|expedia|paypal|intuit|servicenow|workday|snowflake|databricks|
  mongodb|redis|elastic|red hat|redhat|canonical|github|gitlab|swiggy instamart|nestaway|cars24|spinny|ola cabs|
  rapido|bharatpe|mobikwik|pine labs|juspay|chargebee|postman|browserstack|druva|icertis|innovaccer|gupshup|
  khatabook|slice|jupiter|fi money|niyo|acko|digit insurance|star health|max life|lic|sbi life|bajaj allianz|
  hdfc ergo|tata aig|aditya birla|aditya birla capital|ultratech|grasim|vedanta|hindalco|jsw|jsw steel|adani|
  adani group|bpcl|hpcl|iocl|ongc|ntpc|gail|bhel|isro|drdo|barc|irctc|indian railways|air india|indigo|spicejet|
  vistara|tcs digital|mastek|nucleus software|kpit|tata elxsi|happiest minds|quess|teamlease|randstad|adecco|
  manpowergroup|ienergizer|firstsource|wns|exl|hgs|sutherland|startek|tech mahindra bpo
`);

/** Indian cities and states, a few world cities and countries, and work arrangements. */
export const PLACES = words(`
  india|bharat|usa|united states|us|uk|united kingdom|uae|united arab emirates|canada|australia|singapore|germany|
  france|netherlands|ireland|japan|china|saudi arabia|ksa|qatar|oman|kuwait|bahrain|malaysia|new zealand|
  remote|hybrid|on-site|onsite|work from home|wfh|pan india|
  mumbai|bombay|navi mumbai|thane|pune|nagpur|nashik|aurangabad|kolhapur|delhi|new delhi|ncr|delhi ncr|noida|
  greater noida|gurgaon|gurugram|faridabad|ghaziabad|bengaluru|bangalore|mysuru|mysore|mangaluru|mangalore|
  hubli|chennai|madras|coimbatore|madurai|trichy|tiruchirappalli|salem|vellore|hyderabad|secunderabad|
  warangal|vijayawada|visakhapatnam|vizag|guntur|tirupati|kolkata|calcutta|howrah|durgapur|siliguri|ahmedabad|
  gandhinagar|surat|vadodara|baroda|rajkot|jaipur|jodhpur|udaipur|kota|ajmer|lucknow|kanpur|agra|varanasi|
  prayagraj|allahabad|meerut|bareilly|chandigarh|mohali|panchkula|ludhiana|amritsar|jalandhar|patiala|dehradun|
  haridwar|shimla|jammu|srinagar|bhopal|indore|gwalior|jabalpur|raipur|bilaspur|ranchi|jamshedpur|dhanbad|patna|
  gaya|bhubaneswar|cuttack|rourkela|guwahati|shillong|imphal|agartala|kochi|cochin|ernakulam|trivandrum|
  thiruvananthapuram|kozhikode|calicut|thrissur|kollam|kannur|goa|panaji|margao|pondicherry|puducherry|
  maharashtra|karnataka|tamil nadu|kerala|telangana|andhra pradesh|west bengal|gujarat|rajasthan|uttar pradesh|
  up|madhya pradesh|mp|haryana|punjab|uttarakhand|himachal pradesh|jharkhand|bihar|odisha|orissa|assam|
  chhattisgarh|jammu and kashmir|j&k|meghalaya|manipur|tripura|sikkim|mizoram|nagaland|arunachal pradesh|
  dubai|abu dhabi|sharjah|doha|riyadh|jeddah|muscat|london|manchester|new york|san francisco|seattle|austin|
  boston|chicago|los angeles|toronto|vancouver|sydney|melbourne|berlin|munich|amsterdam|paris|dublin|tokyo|
  hong kong|kuala lumpur|bay area|silicon valley
`);

/** US states and Canadian provinces as written after a city: "San Francisco, CA". */
export const REGION_CODES = words(`
  al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|
  or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy|dc|on|bc|ab|qc|up|mp|hp|uk|tn|ap|wb
`);

/** Verbs that open a description line rather than a job header. */
export const ACTION_VERBS = words(`
  managed|led|lead|built|developed|designed|created|implemented|improved|increased|reduced|achieved|handled|
  prepared|maintained|ran|grew|cut|added|worked|responsible|coordinated|conducted|delivered|launched|established|
  supported|assisted|analyzed|analysed|collaborated|drove|owned|oversaw|executed|generated|resolved|trained|
  mentored|automated|optimized|optimised|migrated|wrote|performed|monitored|negotiated|partnered|spearheaded|
  streamlined|utilized|utilised|used|introduced|organized|organised|processed|provided|recruited|redesigned|
  reported|reviewed|scaled|shipped|sourced|tested|developing|managing|handling|leading|working|building|
  designing|creating|ensuring|ensured|achieving|completed|contributed|deployed|enhanced|facilitated|identified|
  initiated|integrated|mapped|planned|produced|promoted|refactored|researched|secured|simplified|solved|
  translated|upgraded|won|awarded|cross-sold|sold|closed|onboarded|hired|interviewed|served|taught|guided|
  set|setup|took|gave|made|helped|involved|participated|attended|learned|learnt|gained|acquired|exposure|
  handled|liaised|collected|compiled|drafted|filed|tracked|updated|verified|audited|reconciled|booked|answered|
  achieved|exceeded|maintaining|preparing|coordinating|conducting|delivering|supporting|assisting|analyzing
`);

/** The phrases "Present", "Till date" and friends that close a date range. */
export const PRESENT_WORDS = words('present|current|currently|now|till date|to date|till now|today|ongoing|date');
