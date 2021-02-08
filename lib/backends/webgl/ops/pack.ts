// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

import {Tensor} from '../../../tensor';
import {WebGLInferenceHandler} from '../inference-handler';
import {ProgramInfo, RunData, WebGLOperator} from '../types';
import {getCoordsDataType} from '../utils';

import {getChannels} from './packing_utils';

export class WebGLPack implements WebGLOperator {
  run(inferenceHandler: WebGLInferenceHandler, inputs: Tensor[]): Tensor[] {
    return inferenceHandler.run(this, inputs);
  }
  createProgramInfo(handler: WebGLInferenceHandler, inputs: Tensor[]): ProgramInfo {
    if (inputs.length !== 1) {
      throw new Error(`Pack kernel should have input tensor count to 1.`);
    }

    const inputShape = inputs[0].dims;

    // TODO(Du): look into ways to simplify createTextureLayoutFromShape's signature
    const outputLayout = handler.createTextureLayoutFromShape(inputShape, 4, inputShape, {isPacked: true});
    const outputShape = outputLayout.shape;
    const rank = outputShape.length;

    const coordsDataType = getCoordsDataType(rank);
    // 47, 17: export function getCoordsDataType(rank: number): string {
    const channels = getChannels('rc', rank);
    const setup = getSetup(rank, channels, inputShape[inputShape.length - 2], inputShape[inputShape.length - 1]);

    const outOfBoundsCondition = getOutOfBoundsCondition(rank, inputShape, channels);
    const output = getOutput(inputShape, channels);
    const shaderSource = `
        void main() {
          // TODO(TJ): implement getOutputCoords() to map input uv to output xy.
          ${coordsDataType} rc = getOutputCoords();

          if(${outOfBoundsCondition}) {
            outputColor = vec4(0);
          } else {
            ${setup}

            outputColor = vec4(${output});
          }
        }
      `;

    return {
      inputLayouts: [handler.getOrCreateTextureLayout(inputs[0])],
      outputLayout,
      samplers: ['A'],
      shaderSource,
      hasMain: true,
      isInputsPacked: false,
      isOutputPacked: true,
    };
  }
  createRunData(handler: WebGLInferenceHandler, programInfo: ProgramInfo, inputs: Tensor[]): RunData {
    const inputTDs = [handler.getOrCreateTextureData(inputs[0], programInfo.inputLayouts[0])];
    return {
      inputTextureDatas: inputTDs,
      outputTextureData: handler.createTextureDataFromLayout(programInfo.outputLayout, inputTDs[0].tensor.type),
      uniformData: {}
    };
  }
}

function getOutOfBoundsCondition(rank: number, shape: ReadonlyArray<number>, dims: string[]): string {
  if (rank === 1) {
    return `rc > ${shape[0]}`;
  }

  let cond = '';
  for (let i = rank - 2; i < rank; i++) {
    cond += `${dims[i]} >= ${shape[i]}`;
    if (i < rank - 1) {
      cond += '||';
    }
  }

  return cond;
}

function getOutput(shape: ReadonlyArray<number>, dims: string[]): string {
  const rank = shape.length;
  if (rank === 1) {
    return `getA(rc),
            rc + 1 >= ${shape[0]} ? 0. : getA(rc + 1),
            0, 0`;
  }

  const coord00 = 'r, c';
  const coord01 = 'r, cp1';
  const coord10 = 'rp1, c';
  const coord11 = 'rp1, cp1';
  let D = '';
  if (rank > 2) {
    for (let i = 0; i < rank - 2; ++i) {
      D = D + `${dims[i]},`;
    }
  }
  return `getA(${D}${coord00}),
          rEdge ? 0. : getA(${D}${coord10}),
          cEdge ? 0. : getA(${D}${coord01}),
          rEdge || cEdge ? 0. : getA(${D}${coord11})`;
}

function getSetup(rank: number, dims: string[], rows: number, cols: number): string {
  if (rank === 1) {
    return '';
  }
  // rank >= 2 for width+height pack.
  else {
    const setup = `
    int r = ${dims[rank - 2]};
    int c = ${dims[rank - 1]};
    int rp1 = ${dims[rank - 2]} + 1;
    int cp1 = ${dims[rank - 1]} + 1;
    bool rEdge = rp1 >= ${rows};
    bool cEdge = cp1 >= ${cols};
    `;
    return setup;
  }
}