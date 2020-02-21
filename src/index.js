const { BaseKonnector, utils, errors, log } = require('cozy-konnector-libs')
const got = require('../libs/got').extend({
  decompress: false
})
const courrierUrl = 'https://courriers.pole-emploi.fr'
const candidatUrl = 'https://candidat.pole-emploi.fr'
const { parse, subYears, format } = require('date-fns')

module.exports = new BaseKonnector(start)

async function start(fields) {
  await authenticate(fields)

  const avisSituation = await fetchAvisSituation()
  await this.saveFiles([avisSituation], fields, {
    contentType: true,
    fileIdAttributes: ['vendorRef']
  })
  const docs = await fetchCourriers()

  await this.saveBills(docs, fields, {
    fileIdAttributes: ['vendorRef'],
    linkBankOperations: false,
    contentType: 'application/pdf',
    processPdf: parseAmountAndDate
  })
}

async function fetchAvisSituation() {
  return {
    fetchFile: async () => {
      let resp = await got(
        'https://candidat.pole-emploi.fr/candidat/situationadministrative/suiviinscription/attestation/mesattestations/true'
      )
      resp = await got.post(
        candidatUrl + resp.$('#Formulaire').attr('action'),
        {
          form: {
            ...resp.getFormData('#Formulaire'),
            attestationsSelectModel: 'AVIS_DE_SITUATION'
          }
        }
      )

      const link = candidatUrl + resp.$('.pdf-fat-link').attr('href')
      return got.stream(link)
    },
    shouldReplaceFile: () => true,
    filename: `${utils.formatDate(
      new Date()
    )}_polemploi_Dernier avis de situation.pdf`,
    vendorRef: 'AVIS_DE_SITUATION'
  }
}

async function fetchCourriers() {
  try {
    let resp = await got(
      'https://authentification-candidat.pole-emploi.fr/compte/redirigervers?url=https://courriers.pole-emploi.fr/courriersweb/acces/AccesCourriers'
    )

    resp = await got.post(resp.$('form').attr('action'), {
      form: resp.getFormData('form')
    })

    // get a maximum of files (minus 10 years)
    const form = resp.getFormData('form#formulaire')
    form.dateDebut = format(
      subYears(parse(form.dateDebut, 'dd/MM/yyyy', new Date()), 10),
      'dd/MM/yyyy'
    )

    resp = await got.post(
      courrierUrl + resp.$('form#formulaire').attr('action'),
      { form }
    )

    let docs = []
    while (resp) {
      const result = await getPage(resp)
      resp = result.nextResp
      docs = [...docs, ...result.docs]
    }
    return docs
  } catch (err) {
    if (err.response && err.response.statusCode === 500) {
      log('error', err.message)
      throw new Error(errors.VENDOR_DOWN)
    } else {
      throw err
    }
  }
}

async function getPage(resp) {
  const fetchFile = async doc =>
    got.stream(courrierUrl + (await got(doc.url)).$('iframe').attr('src'))
  const docs = resp
    .scrape(
      {
        date: {
          sel: '.date',
          parse: date =>
            date
              .split('/')
              .reverse()
              .join('-')
        },
        type: '.avisPaie',
        url: {
          sel: '.Telechar a',
          attr: 'href',
          parse: href => `${courrierUrl}${href}`
        },
        vendorRef: {
          sel: '.Telechar a',
          attr: 'href',
          parse: href => href.split('/').pop()
        }
      },
      'table tbody tr'
    )
    .map(doc => ({
      ...doc,
      fetchFile,
      filename: `${utils.formatDate(doc.date)}_polemploi_${doc.type}_${
        doc.vendorRef
      }.pdf`,
      vendor: 'Pole Emploi'
    }))

  const nextLink =
    '/courriersweb/mescourriers.bloclistecourriers.numerotation.boutonnext'
  const hasNext = Boolean(resp.$(`.pagination a[href='${nextLink}']`).length)
  let nextResp = false

  if (hasNext) nextResp = await got(courrierUrl + nextLink)

  return { docs, nextResp }
}

async function authenticate({ login, password }) {
  log('debug', 'authenticating...')
  try {
    const state = {
      state: randomizeString(16),
      nonce: randomizeString(16)
    }
    await got(
      'https://authentification-candidat.pole-emploi.fr/connexion/oauth2/authorize',
      {
        searchParams: {
          realm: '/individu',
          response_type: 'id_token token',
          scope:
            'openid idRci profile contexteAuthentification email courrier notifications etatcivil logW individu pilote nomenclature coordonnees navigation reclamation prdvl idIdentiteExterne pole_emploi suggestions actu application_USG_PN073-tdbcandidat_6408B42F17FC872440D4FF01BA6BAB16999CD903772C528808D1E6FA2B585CF2',
          client_id:
            'USG_PN073-tdbcandidat_6408B42F17FC872440D4FF01BA6BAB16999CD903772C528808D1E6FA2B585CF2',
          ...state
        }
      }
    )

    let authBody = await got
      .post(
        'https://authentification-candidat.pole-emploi.fr/connexion/json/authenticate',
        {
          searchParams: {
            realm: '/individu'
          }
        }
      )
      .json()

    authBody.callbacks[0].input[0].value = login

    authBody = await got
      .post(
        'https://authentification-candidat.pole-emploi.fr/connexion/json/authenticate',
        {
          json: authBody
        }
      )
      .json()

    authBody.callbacks[1].input[0].value = password
    authBody = await got
      .post(
        'https://authentification-candidat.pole-emploi.fr/connexion/json/authenticate',
        {
          json: authBody
        }
      )
      .json()

    await got.defaults.options.cookieJar.setCookie(
      `idutkes=${authBody.tokenId}`,
      'https://authentification-candidat.pole-emploi.fr',
      {}
    )
    await got
      .post(
        'https://authentification-candidat.pole-emploi.fr/connexion/json/users?_action=idFromSession&realm=/individu'
      )
      .json()
  } catch (err) {
    if (err.response && err.response.statusCode === 401)
      throw new Error(errors.LOGIN_FAILED)
    else throw err
  }
}

// alg taken directly form the website
function randomizeString(e) {
  for (
    var t = [''],
      n = '0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-',
      r = 0;
    r < e;
    r++
  ) {
    t.push(n[Math.floor(Math.random() * n.length)])
  }
  return t.join('')
}

function parseAmountAndDate(entry, text) {
  // at the moment, only 'Relevés de situation' have bills data ignore any other file
  if (entry.type !== 'Relevé de situation') {
    entry.__ignore = true
    return entry
  }

  // find date and amount lines in pdf
  const lines = text.split('\n')
  const dateLines = lines
    .map(line => line.match(/^REGLEMENT\sDU\s(.*)$/))
    .filter(Boolean)
  if (dateLines.length === 0) {
    log('warn', `found no paiment dates`)
  }
  const amountLines = lines
    .map(line => line.match(/^Règlement de (.*) euros par (.*)$/))
    .filter(Boolean)
  if (amountLines.length === 0) {
    log('warn', `found no paiment amounts`)
  }

  // generate bills data from it. We can multiple bills associated to one file
  const bills = []
  for (let i = 0; i < dateLines.length; i++) {
    const date = parse(dateLines[i].slice(1, 2).pop(), 'dd/MM/yyyy', new Date())
    const amount = parseFloat(
      amountLines[i]
        .slice(1, 2)
        .pop()
        .replace(',', '.')
    )
    if (date && amount) {
      bills.push({ ...entry, date, amount, isRefund: true })
    }
  }

  if (bills.length === 0) {
    // first bills is associated to the current entry
    entry.__ignore = true
    log('warn', 'could not find any date or amount in this document')
  } else {
    // next bills will generate a new entry associated to the same file
    Object.assign(entry, bills.shift())
    return bills
  }

  return entry
}
