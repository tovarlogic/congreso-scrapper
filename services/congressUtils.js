/* ---------- DEPENDENCIES ---------- */
const { request } = require('http');
const https = require('https');
const fs = require('fs').promises;
const axios = require('axios');
const cheerio = require('cheerio');
const { url } = require('inspector');

// Define the scrapping URL and method
const { urls, endPoints, pages, docs } = require('../config/congressUtils');
const convertionUtils = require('./convertionUtils');

// Variable global para almacenar las cookies
let storedCookies = null;

//Topology data to be inherited
let current_supertype = null;
let current_type = null;
let current_subtype = null;
let current_subsubtype = null;

////////////////////////////////////////////////////////////////////////////////////////////////////
// -------------------    Functions to setup Axios https requests ---------------------------

async function getCookies() {
  if (storedCookies) {
    return storedCookies;
  }

  try {
      const response = await axios.get(urls.https);
      const cookies = response.headers['set-cookie'];
      storedCookies = cookies;
      return cookies;
  } catch (error) {
      console.error('Error al obtener las cookies:', error);
      return null;
  }
}

function setRequestHeaders(referer, cookies) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/112.0',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
    'Origin': urls.https,
    'DNT': '1',
    'Referer': referer,
    'Cookie': cookies,
  };
  return headers;
}

async function setRequest(method, request_url, params) {
  // Obtiene cookies válidas
  const cookies = await getCookies();
  if (!cookies) {
    console.error('Initiatives [Error]', 'not valid cookies retrieved');
    return false;
  }

  // Construye los encabezados de la solicitud
  const headers = setRequestHeaders(request_url, cookies);

  if(method.toUpperCase() == 'GET' ) {
    // Construye el objeto URLSearchParams con los parámetros de consulta
    const queryParams = new URLSearchParams();
    for (const key in params) {
      queryParams.append(key, params[key]);
    }

    //set axios config
    const config = {
      method: 'GET',
      url: request_url + '?' + queryParams.toString(),
      headers: headers
    };
    
    return config;
  }else if(method.toUpperCase() == 'POST') {
    // Construye el objeto formData con los filtros
    const formData = new URLSearchParams();
    for (const key in params) {
        formData.append(key, params[key]);
    }

    //set axios config
    const config = {
      method: 'post',
      url: request_url,
      headers: headers,
      data: formData,
    };
    return config;
  }

  return false;
}

////////////////////////////////////////////////////////////////////
// ----------- Functions to transform datasets ---------------------

function transformRepresentativesData(data) {
  let representatives = [];
  let representatives_terms = [];

  for (const representativeData of data) {
    const rep = {
      surnames: representativeData.apellidos,
      name: representativeData.nombre,
      gender: representativeData.genero == 1 ? 'M' : 'F',
      profesion: '',
      terms: [],
    };
    representatives.push(rep);

    const term = {
      term: representativeData.idLegislatura,
      representativeId: representativeData.codParlamentario,
      circunscripcion: representativeData.nombreCircunscripcion,
      party: representativeData.formacion,
      parliamentGroup: representativeData.grupo,
      startDate: representativeData.fchAlta,
      endDate: representativeData.fchBaja,
    };
    representatives_terms.push(term);

    }

    return { representatives, representatives_terms };
}


function transformInitiativeData(data) {
  const initiativesArray = Object.values(data);
  const simplifiedData = initiativesArray.map(iniciativa => {
    const newItem = {
      term: (iniciativa.legislatura == 'C') ? '0' : convertionUtils.romanToInt(iniciativa.legislatura),
      initiativeId: iniciativa.id_iniciativa,
      initiativeType: iniciativa.id_iniciativa.split('/')[0],
      title: iniciativa.titulo,
      presentedDate: iniciativa.fecha_presentado,
      qualifiedDate: iniciativa.fecha_calificado,
      result: iniciativa.resultado_tram
    };    
    return newItem;
  });
  return simplifiedData;
}

function transformPairlamentGroupData(data){
  const groupsArray = Object.values(data);

  const simplifiedData = groupsArray.map(group => {
    const newItem = {
      term: group.idLegislatura,
      name: group.grpDesc,
      code: group.codOrg,
      seats: group.numMiembros
    };    
    return newItem;
  });

  return simplifiedData;
}

function transformBodyCompositionData(term, comissionCode, data, subcomissionCode = null){
  let representatives = [];

  for (const representativeData of data.data) {
    const url = new URL(representativeData.urlFichaDiputado, 'https://example.com');
    const params = new URLSearchParams(url.search);
    const codParlamentario = params.get('codParlamentario');

    const rep = {
      id: codParlamentario,
      name: representativeData.apellidosNombre,
      position: representativeData.descCargo,
      startDate: representativeData.fechaAltaFormat,
      endDate: (representativeData.fechaBajaFormat)? representativeData.fechaBajaFormat : ''
    };

    representatives.push(rep);
  }

  const simplifiedData = {
    code: subcomissionCode || comissionCode,
    startDate: data.fechaConstitucion.fechaConstitucion,
    endDate: (data.fechaDisolucion.fechaDisolucion)? data.fechaDisolucion.fechaDisolucion : '',
    representatives: representatives
  }

  // Add the term only if we are dealing with a commission
  if (!subcomissionCode) {
    simplifiedData.term = term;
  }

  return simplifiedData;
}



// Función de comparación personalizada para ordenar por la clave 'iniciativaXXXX'
function compareIniciativaKeys(a, b) {
  const keyA = parseInt(a.replace("iniciativa", ""));
  const keyB = parseInt(b.replace("iniciativa", ""));

  return keyA - keyB;
}

function processTopologyInheritance(initiatives) {
  const sortedKeys = Object.keys(initiatives).sort(compareIniciativaKeys);
  const data = [];

  for (const key of sortedKeys) {
    const iniciativa = initiatives[key];
    
    // Set topology data to be inherited
    if (iniciativa.atis) { 
      current_supertype = iniciativa.atis.toLowerCase();
      current_type = null;
      current_subtype = null;
      current_subsubtype = null;

      if (iniciativa.atip) { 
        current_type = iniciativa.atip.toLowerCase();
        if (iniciativa.tpai) {
          current_subtype = iniciativa.tpai.toLowerCase();
          if(iniciativa.tipo) { 
            current_subsubtype = iniciativa.tipo.toLowerCase();
          }
        } else if (iniciativa.tipo) { 
          current_subtype = iniciativa.tipo.toLowerCase();
        }
      } else if (iniciativa.tipo) { 
        current_type = iniciativa.tipo.toLowerCase();
      }
    } else if (iniciativa.atip) {
      current_type = iniciativa.atip.toLowerCase();
      current_subtype = null;
      current_subsubtype = null;
      if(iniciativa.tipo) current_subtype = iniciativa.tipo.toLowerCase();
  
    } else if (iniciativa.tpai) {
      current_type = iniciativa.tpai.toLowerCase();
      current_subtype = null;
      current_subsubtype = null;
      if(iniciativa.tipo) current_subtype = iniciativa.tipo.toLowerCase();
  
    } else if(iniciativa.tipo) { 
      if (current_subtype == null) {
        current_type = iniciativa.tipo.toLowerCase();
        current_subsubtype = null;
      } else if (current_subsubtype == null) {
        current_subtype = iniciativa.tipo.toLowerCase();
      } else {
        current_subsubtype = iniciativa.tipo.toLowerCase();
      }
    }

    //assign topology to initiative
    if (current_supertype) iniciativa.supertype = current_supertype;
    if (current_type) iniciativa.type = current_type;
    if (current_subtype) iniciativa.subtype = current_subtype;
    if (current_subsubtype) iniciativa.subsubtype = current_subsubtype;

    data.push(iniciativa); //format initiative data
  }

  return data;
}

function transformTopologyData(data) {
  const topologiesArray = Object.values(data);
  const simplifiedData = topologiesArray.map(iniciativa => {
    const newItem = {
      code: iniciativa.id_iniciativa.split('/')[0],
      supertype: iniciativa.supertype
    };

    if (iniciativa.type) newItem.type = iniciativa.type;
    if (iniciativa.subtype) newItem.subtype = iniciativa.subtype;
    if (iniciativa.subsubtype) newItem.subsubtype = iniciativa.subsubtype;

    return newItem;
  });
  return simplifiedData;
}

function transformTermData(data) {

}

///////////////////////////////////////////////////////////////////////////////////////////////////
// -------------------    Functions to exploit/utilize the congress API ---------------------------

//iniciativas
async function getInitiatives(page, filters = {}) {
  let defaultFilters = {
    term: 'all', // todas las legislaturas 'C'
    title: '',
    text: '',
    author: '',
    topology: '',
    type: '',
    processing: '',
    processing_type: '',
    expedient: '',
    until: '',
    comission: '',
    phase: '',
    body: '',
    from: '',
    to: '',
    topic: '',
    related: '',
    origin: '',
    iscc: '',
  };

  // Mezcla los filtros proporcionados con los predeterminados
  const appliedFilters = { ...defaultFilters, ...filters };

  // construct request
  const request_url = `${urls.https}${endPoints.initiatives.path}`;

  let formParams = endPoints.initiatives.params;
  formParams['_iniciativas_legislatura'] = (appliedFilters.term == 'all') ? 'C' : appliedFilters.term;
  formParams['_iniciativas_paginaActual'] = page;

  const config = await setRequest('GET', request_url, formParams);

  try {
    const response = await axios(config);
    if (response.status === 200) {
      let items = response.data.iniciativas_encontradas;
      let pages = Math.ceil(items/25); 
      let data = processTopologyInheritance(response.data.lista_iniciativas);
      let initiativeData = transformInitiativeData(data);
      let topologyData = transformTopologyData(data);

        // Group initiatives with their respective topology data
      const initiatives = initiativeData.map((initiative, index) => {
        return {
          ...initiative,
          topologyData: topologyData[index],
        };
      });

      return { items, pages, initiatives };
    } else {
      console.error('Initiatives [ERROR]', 'Error en la solicitud');
    }
  } catch (error) {
    console.error('Initiatives [ERROR]', error);
  }
}

//diputados
async function getRepresentatives(filters = {}) {
  let defaultFilters = {
    term: 'all',
    gender: 'all', //1 = Male; 0 = Female
    group: 'all', 
    type: 'all', // 1 = active; 0 = inactive ???
    party: 'all',
    provinces: 'all',
    circunscripcion: 'all' // for any [name1,name2]
  };

  // Mezcla los filtros proporcionados con los predeterminados
  const appliedFilters = { ...defaultFilters, ...filters };

  // construct request
  const request_url = `${urls.https}${endPoints.representatives.path}`;
  let formParams = endPoints.representatives.params;
  formParams['_diputadomodule_idLegislatura'] = (appliedFilters.term == 'all') ? '-1' : appliedFilters.term;
  formParams['_diputadomodule_genero'] = (appliedFilters.gender == 'all') ? '0' : (appliedFilters.gender == '1') ? 'M' : 'F';
  formParams['_diputadomodule_grupo'] = appliedFilters.group;
  formParams['_diputadomodule_tipo'] = (appliedFilters.type == 'all') ? '2' : appliedFilters.type;
  formParams['_diputadomodule_formacion'] = appliedFilters.party;
  formParams['_diputadomodule_filtroProvincias'] = (appliedFilters.provinces == 'all') ? '[]' : appliedFilters.provinces;
  formParams['_diputadomodule_nombreCircunscripcion'] = (appliedFilters.circunscripcion == 'all') ? '' : appliedFilters.circunscripcion;
  
  const config = await setRequest('POST', request_url, formParams);

  try {
      const response = await axios(config);
      if (response.status === 200) {
          let results = transformRepresentativesData(response.data.data);
          return results;
      } else {
          console.error('Representative [ERROR]', 'Error en la solicitud');
      }
  } catch (error) {
      console.error('Representative [ERROR]', error);
  }
}

// comisiones
async function scrapeComissions(filters = {}) {
  let defaultFilters = {
    term: '0',
  };

  // Mezcla los filtros proporcionados con los predeterminados
  const appliedFilters = { ...defaultFilters, ...filters };

  // construct request
  const request_url = `${urls.https}${endPoints.comissions.path}`;
  let params = endPoints.comissions.params;
  params['_organos_selectedLegislatura'] = (appliedFilters.term == '0') ? '0' : convertionUtils.intToRoman(appliedFilters.term);

  const config = await setRequest('GET', request_url, params);

  try {
    const response = await axios(config);
    if (response.status === 200) {
      const $ = cheerio.load(response.data);
      const results = [];
      let currentType = '';
  
      const portletOrganos = $('#portlet_organos');
  
      portletOrganos.find('h2, h3, div > a').each((_, element) => {
        const tagName = $(element).prop('tagName');
  
        if (tagName === 'H3') {
          currentType = $(element).text().trim();
        } else if (tagName === 'A' && $(element).hasClass('isComision')) {
          const href = $(element).attr('href');
          const name = $(element).text().trim();
          let code = /_organos_codComision=([^&]+)/.exec(href)?.[1] || null;
          if (code == null) code = /_organos_selectedSuborgano=([^&]+)/.exec(href)?.[1] || null;
          results.push({ code, name, type: currentType });
        }
      });
  
      // Remove duplicates based on commission code
      const uniqueResults = Array.from(new Map(results.map((item) => [item.code, item])).values());
  
      return uniqueResults;
    } else {
      console.error('Comissions [ERROR]', 'Error en la solicitud');
    }
  } catch (error) {
    console.error('Comissions [ERROR]', error);
  }

}

async function getBodyComposition(term, comissionCode, subcomissionCode = null){
  // construct request
  const request_url = `${urls.https}${endPoints.comission_composition.path}`;

  let formParams = endPoints.comission_composition.params;
  formParams['_organos_selectedLegislatura'] = convertionUtils.intToRoman(term);
  formParams['_organos_compoHistorica'] = 'true';
  formParams['_organos_selectedOrganoSup'] = subcomissionCode ? comissionCode : '1';
  formParams['_organos_selectedSuborgano'] = subcomissionCode || comissionCode;

  const config = await setRequest('POST', request_url, formParams);

  try {
    const response = await axios(config);
    if (response.status === 200) {
        let results = transformBodyCompositionData(term, comissionCode, response.data, subcomissionCode);
        return results;
    } else {
        console.error('Representative [ERROR]', 'Error en la solicitud');
    }
  } catch (error) {
      console.error('Representative [ERROR]', error);
  }
}


// subcomisiones y ponencias
async function scrapeSubcomissions(filters = {}) {
  let defaultFilters = {
    term: '0',  
  };

  // Mezcla los filtros proporcionados con los predeterminados
  const appliedFilters = { ...defaultFilters, ...filters };

  // construct request
  let request_url = `${urls.https}${endPoints.subcomissions.path}`;
  let params = endPoints.subcomissions.params;
  params['_organos_selectedLegislatura'] = (appliedFilters.term == '0') ? '0' : convertionUtils.intToRoman(appliedFilters.term);
  
  const config = await setRequest('GET', request_url, params);

  try {
    const response = await axios(config);
    if (response.status === 200) {
      const $ = cheerio.load(response.data);
      const results = [];
  
      const portletOrganos = $('#portlet_organos');

      portletOrganos.find('ul > li > a').each((_, element) => {
        const href = $(element).attr('href');
        const name = $(element).text().trim();
        let code = /_organos_codSubcomision=([^&]+)/.exec(href)?.[1] || null;
        if (code == null) code = /_organos_selectedSuborgano=([^&]+)/.exec(href)?.[1] || null;
        let commissionCode = code ? code.substring(0, 3) : null;
        results.push({ code, name, commissionCode });
      });
  
      // Remove duplicates based on subcommission code
      const uniqueResults = Array.from(new Map(results.map((item) => [item.code, item])).values());
  
      return uniqueResults;
    } else {
      console.error('Subcomissions [ERROR]', 'Error en la solicitud');
    }
  } catch (error) {
    console.error('Subcomissions [ERROR]', error);
  }
}


//composición grupos parlamentarios 
async function getParliamentGroups(filters = {}) {  
  let defaultFilters = {
    term: '0',
  };

  // Mezcla los filtros proporcionados con los predeterminados
  const appliedFilters = { ...defaultFilters, ...filters };

  // construct request
  let request_url = `${urls.https}${endPoints.groups.path}`;
  let formParams = endPoints.groups.params;
  formParams['_grupos_idLegislatura'] = (appliedFilters.term == '0') ? '0' : convertionUtils.intToRoman(appliedFilters.term);

  const config = await setRequest('POST', request_url, formParams);

  try {
    const response = await axios(config);
    if (response.status === 200) {
      let results = transformPairlamentGroupData(response.data.data);
      return results;
    } else {
        console.error('Parliament Groups [ERROR]', 'Error en la solicitud');
    }
  } catch (error) {
      console.error('Parliament Groups [ERROR]', error);
  }
}

//legislaturas
async function getTerms() {
  try {
    const response = await axios.get(`${urls.https}${endPoints.initiatives.path}`);

    const $ = cheerio.load(response.data);

    const terms = [];
    const termOptions = $('#_iniciativas_legislatura option');

    termOptions.each((i, option) => {
      const termText = $(option).text().trim();
      let term = termText.substring(0, termText.indexOf("(")).trim().split(' ')[0];
      const datesText = termText.substring(termText.indexOf("(") + 1, termText.indexOf(")")).trim();
      const dates = datesText.split("-");
      const startDate = dates[0];
      const endDate = dates[1];
      
      if(term !== ""){
          if(term == "Legislatura") 
            term = '0';
          else 
            term = convertionUtils.romanToInt(term);

          terms.push({ term, startDate, endDate });
      }
      
    });

    return terms;

  } catch (error) {
    console.error('Error al obtener las legislaturas desde la web del congreso:', error.message);
    throw error;
  }
};

function generateInitiativesURLs(initiatives) {
  let initiatives_urls = [];
  for( let i = 0; i < initiatives.length; i++) {
    const term = convertionUtils.intToRoman(initiatives[i].term);
    let initiative_url = `${urls.https}${endPoints.initiative.path}`;
    const params = endPoints.initiative.params;
    params['_iniciativas_legislatura'] = term;
    params['_iniciativas_id'] = initiatives[i].initiativeId;

    const queryParams = new URLSearchParams();
    for (const key in params) {
      queryParams.append(key, params[key]);
    }

    initiative_url = initiative_url + '?' + queryParams.toString();
    initiatives_urls.push({term: initiatives[i].term, initiativeId: initiatives[i].initiativeId, url: initiative_url});
  }

  return initiatives_urls;
}

// obtiene todos los detalles relativos a una iniciativa
async function scrapeInitiative(term, initiativeId, url) {
  console.log(`legislatura: ${term} - iniciativa: ${initiativeId}`);
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    const container = $('.iniciativa');

    const dossierUrls = container.find('a[href*="dosieres"]').map((_, el) => $(el).attr('href')).get();

    const authorsList = container.find('h3:contains("Autor")').next('ul');
    
    const authors = authorsList.find('li').map((_, el) => {
      const authorElement = $(el);
      
      const authorLink = authorElement.find('a');
      const authorText = authorElement.text().trim();

      if (authorLink.length > 0) {
        const url = new URL(authorLink.attr('href'), 'https://example.com');
        const searchParams = new URLSearchParams(url.search);

        if (searchParams.has('codParlamentario')) {
          return { type: 'diputado', id: searchParams.get('codParlamentario') };
        } else if (searchParams.has('idGrupo')) {
          return { type: 'grupo', id: searchParams.get('idGrupo') };
        }
      } else {
        if (authorText.toLowerCase().startsWith('comisión')) {
          return { type: 'comission', name: authorText, id: null };
        } else if (authorText.toLowerCase().startsWith('subcomisión')) {
          return { type: 'subcomission', name: authorText, id: null };
        } else {
          return { type: 'other', name: authorText };
        }
      }
    }).get();

    const result = container.find('.resultadoTramitacion').text().trim() || null;
    const status = container.find('.situacionActual').text().trim() || null;
    const type = container.find('.tipoTramitacion').text().trim() || null;

    const competentCommissions = container.find('.comisionesCompetentes li').map((_, el) => {
      const links = $(el).find('a');
      const texts = [];
      const body = [];
      const subBody = [];
    
      links.each((_, link) => {
        const href = $(link).attr('href');
        body.push(/_organos_selectedOrganoSup=([^&]+)/.exec(href)?.[1] || null);
        subBody.push(/_organos_selectedSuborgano=([^&]+)/.exec(href)?.[1] || null);
        texts.push($(link).text().trim());
      });
    
      return { body, subBody, name: texts.join(', ') };
    }).get();

    const parlamentaryCodes = container.find('.ponentes a').map((_, el) => $(el).attr('href').split('=')[1].split('&')[0]).get();

    const initiativeTramitationHtml = container.find('.iniciativaTramitacion').html();
    let initiativeTramitation = [];

    if (initiativeTramitationHtml) {
      initiativeTramitation = initiativeTramitationHtml.trim().split('<br>').map((item) => {
        const parts = item.trim().split(' ');
        const startDateIndex = parts.indexOf('desde') + 1;
        const endDateIndex = parts.indexOf('hasta') + 1;
        const startDate = startDateIndex > 0 ? parts[startDateIndex] : null;
        const endDate = endDateIndex > 0 ? parts[endDateIndex] : null;
        const name = parts.slice(0, startDateIndex - 1).join(' ');
        return { name, startDate, endDate };
      });
    }

    const bulletins = container.find('.boletines li').map((_, el) => {
      const text = $(el).find('div:first-child').text().trim();
      const urls = $(el).find('a').map((_, aEl) => $(aEl).attr('href')).get();
      return { text, urls };
    }).get();

    const diaries = container.find('.diarios li').map((_, el) => {
      const text = $(el).find('div:first-child').text().trim();
      const urlText = $(el).find('div:nth-child(2) a:first-child').attr('href');
      const urlPDF = $(el).find('div:nth-child(2) a:nth-child(2)').attr('href');
      return { text, urlText, urlPDF };
    }).get();

    const boes = container.find('.boes li').map((_, el) => {
      const text = $(el).find('div:first-child').text().trim();
      const url = $(el).find('div:nth-child(2) a').attr('href');
      return { text, url };
    }).get();

    const initiativeData = {
      term: term,
      initiativeId,
      dossierUrls,
      author: authors,
      status: status,
      result: result,
      tramitationType: type,
      competentCommissions: competentCommissions,
      parlamentaryCodes: parlamentaryCodes,
      initiativeTramitation: initiativeTramitation,
      bulletins: bulletins,
      diaries: diaries,
      boes: boes
    };

    
    const filteredData = {};
    for (const [key, value] of Object.entries(initiativeData)) {
      
      if (Array.isArray(value)) { 
        if(value.length !== 0) // if is not an empty array
          filteredData[key] = value;
      }else {
        if (value !== null && value !== undefined) // if is not an empty variable
          filteredData[key] = value;
      }
    }

    return filteredData;

  } catch (error) {
    console.error(`Error al extraer información de la iniciativa: ${error.message}`);
  }
}

module.exports = {
    getInitiatives,
    getRepresentatives,
    scrapeComissions,
    scrapeSubcomissions,
    getTerms,
    getParliamentGroups,
    generateInitiativesURLs,
    scrapeInitiative,
    getBodyComposition,
};