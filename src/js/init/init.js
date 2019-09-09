/**
 * @fileoveriew Methods for initialization
 */

import {d3} from '../lib';
import {configure} from './configure';
import {finishInit} from './finish-init';
import {writeContainer} from './write-container';
import {shouldFetchBands, fetchBands} from '../bands/fetch';
import {organismMetadata} from './organism-metadata';

function isHeterogameticChromosome(chrModel, chrIndex, ideo) {
  var ploidy = ideo.config.ploidy;
  return (
    'sex' in ideo.config &&
      (
        ploidy === 2 && ideo.sexChromosomes.index + 2 === chrIndex ||
        ideo.config.sex === 'female' && chrModel.name === 'Y'
      )
  );
}

function prepareChromosomes(bandsArray, chrs, taxid, chrIndex, ideo) {
  var j, bands, chromosome, chrModel;

  for (j = 0; j < chrs.length; j++) {
    chromosome = chrs[j];
    if ('bandsArray' in ideo) bands = bandsArray[chrIndex];

    chrModel = ideo.getChromosomeModel(bands, chromosome, taxid, chrIndex);

    chrIndex += 1;

    if (typeof chromosome !== 'string') chromosome = chromosome.name;

    ideo.chromosomes[taxid][chromosome] = chrModel;
    ideo.chromosomesArray.push(chrModel);

    if (isHeterogameticChromosome(chrModel, chrIndex, ideo)) continue;

    ideo.drawChromosome(chrModel);
  }

  return chrIndex;
}

function setCoordinateSystem(chrs, ideo) {
  if (
    typeof chrBands !== 'undefined' &&
    chrs.length >= chrBands.length / 2
  ) {
    ideo.coordinateSystem = 'bp';
  }
}

/**
 * Configures chromosome data and calls downstream chromosome drawing functions
 */
function initDrawChromosomes(bandsArray) {
  var ideo = this,
    taxids = ideo.config.taxids,
    chrIndex = 0,
    taxid, i, chrs;

  if (bandsArray.length > 0) ideo.bandsArray = {};

  for (i = 0; i < taxids.length; i++) {
    taxid = taxids[i];
    chrs = ideo.config.chromosomes[taxid];

    setCoordinateSystem(chrs, ideo);

    ideo.chromosomes[taxid] = {};
    ideo.setSexChromosomes(chrs);

    if ('bandsArray' in ideo) ideo.bandsArray[taxid] = bandsArray;

    chrIndex = prepareChromosomes(bandsArray, chrs, taxid, chrIndex, ideo);

    if (ideo.config.showBandLabels) ideo.drawBandLabels(ideo.chromosomes);
    ideo.handleRotateOnClick();
    ideo._gotChrModels = true; // Prevent issue with errant rat centromeres
  }
}

/**
 * Attach any click handlers to rotate and toggle chromosomes
 */
function handleRotateOnClick() {
  var ideo = this;

  if (!('rotatable' in ideo.config && ideo.config.rotatable === false)) {
    d3.selectAll(ideo.selector + ' .chromosome').on('click', function() {
      ideo.rotateAndToggleDisplay(this);
    });
  } else {
    d3.selectAll(ideo.selector + ' .chromosome')
      .style('cursor', 'default');
  }
}

/**
 * Called when Ideogram has finished initializing.
 * Accounts for certain ideogram properties not being set until
 * asynchronous requests succeed, etc.
 */
function onLoad() {
  call(this.onLoadCallback);
}

function getBandFileName(taxid, accession, ideo) {
  var organism = ideo.organisms[taxid];
  var bandFileName = [Ideogram.slugify(organism.scientificName)];
  var assemblies = organism.assemblies;
  var resolution = ideo.config.resolution;

  if (accession !== assemblies.default) {
    bandFileName.push(accession);
  }
  if (
    taxid === '9606' &&
    (accession in assemblies === 'false' &&
      Object.values(assemblies).includes(config.assembly) ||
      (resolution !== '' && resolution !== 850))
  ) {
    bandFileName.push(resolution);
  }

  bandFileName = bandFileName.join('-');

  var fullyBandedTaxids = ['9606', '10090', '10116'];
  if (fullyBandedTaxids.includes(taxid) && !ideo.config.showFullyBanded) {
    bandFileName += '-no-bands';
  }

  bandFileName += '.json';

  return bandFileName;
}

function getBandFileNames(taxid, bandFileNames, ideo) {
  var organism, assemblies, accession, bandFileName,
    config = ideo.config;

  organism = ideo.organisms[taxid];

  if (!config.assembly) ideo.config.assembly = 'default';

  assemblies = organism.assemblies;

  if (ideo.assemblyIsAccession()) {
    accession = config.assembly;
  } else {
    accession = assemblies[config.assembly];
  }

  bandFileName = getBandFileName(taxid, accession, ideo);

  if (taxid in ideo.organismsWithBands) {
    bandFileNames[taxid] = bandFileName;
  }
  return bandFileNames;
}

function prepareContainer(taxid, bandFileNames, t0, ideo) {

  if (shouldFetchBands(bandFileNames, taxid, ideo)) {
    return fetchBands(bandFileNames, taxid, t0, ideo);
  } else {
    return new Promise(function() {
      return ideo.processBandData(taxid);
    });
  }
}

function initializeTaxids(ideo) {
  console.log('initializeTaxids')
  return new Promise(function(resolve) {
    if (typeof ideo.config.organism === 'number') {
      // 'organism' is a taxid, e.g. 9606
      ideo.getOrganismFromEutils(function() {
        ideo.getTaxids(resolve);
      });
    } else {
      ideo.getTaxids(resolve);
    }
  });
}

function getBandsAndPrepareContainer(taxids, t0, ideo) {
  var bandFileNames, i, taxid,
    promises = [];

  bandFileNames = {};
  for (taxid in organismMetadata) {
    bandFileNames[taxid] = '';
  }

  for (i = 0; i < taxids.length; i++) {
    taxid = String(taxids[i]);
    bandFileNames = getBandFileNames(taxid, bandFileNames, ideo);
    promises.push(prepareContainer(taxid, bandFileNames, t0, ideo));
  }

  Promise.all(promises).then(function(bandsArray) {
    console.log('in Promise.all, bandsArray:');
    console.log(bandsArray);
    ideo.writeContainer(bandsArray, t0);
  });
}

/**
 * Initializes an ideogram.
 * Sets some high-level properties based on instance configuration,
 * fetches band and annotation data if needed, and
 * writes an SVG element to the document to contain the ideogram
 */
// Prevents race condition when init is called multiple times in quick succession.
// See https://github.com/eweitz/ideogram/pull/154.
var ideoNext = {};
var ideoQueued = {};
var ideoWait = {};

function init(ideo) {
  ideo = ideo || this;
  var containerId = ideo.config.container;

  if (ideoWait[containerId]) {
    ideoQueued[containerId] = true;
    ideoNext[containerId] = ideo;
  } else {
    ideoWait[containerId] = true;
    initializeTaxids(ideo)
      .then(function(taxids) {

        var taxid = taxids[0];
        ideo.config.taxid = taxid;
        ideo.config.taxids = taxids;

        var t0 = new Date().getTime();
        getBandsAndPrepareContainer(taxids, t0, ideo);

        ideoWait[containerId] = false;
        if (ideoQueued[containerId]) {
          ideoQueued[containerId] = false;
          init(ideoNext[containerId]);
        }
      });
  }
}

export {
  configure, initDrawChromosomes, handleRotateOnClick,
  onLoad, init, finishInit, writeContainer
};
