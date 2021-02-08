// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

import {MatMul} from '../../../ops/matmul';
import {Tensor} from '../../../tensor';
import {BroadcastUtil} from '../../../util';
import {WebGLInferenceHandler} from '../inference-handler';
import {ProgramInfo, RunData, WebGLOperator} from '../types';

export class WebGLMatMulPacked extends MatMul implements WebGLOperator {
  run(inferenceHandler: WebGLInferenceHandler, inputs: Tensor[]): Tensor[] {
    return inferenceHandler.run(this, inputs);
  }
  createProgramInfo(handler: WebGLInferenceHandler, inputs: Tensor[]): ProgramInfo {
    const aShape = inputs[0].dims;
    const bShape = inputs[1].dims;
    const outputShape = BroadcastUtil.calcShape(aShape, bShape, true);
    if (!outputShape) {
      throw new Error('Can\'t use matmul on the given tensors');
    }
    const rank = outputShape.length;
    const arank = aShape.length;
    const brank = bShape.length;
    const sharedDim = aShape[aShape.length - 1];
    const shaderSource = `
      vec4 process(int indices[${rank}]) {
          ivec2 rc = getOutputCoords();
          int a[${arank}];
          int b[${brank}];
          bcastMatmulIndices_A(indices, a);
          bcastMatmulIndices_B(indices, b);

          vec4 value;
          for (int k=0; k<((${sharedDim}+1)/2); ++k) {
              a[${arank - 1}] = 0;
              b[${brank - 2}] = 0;
              //value += _A_Pack(a).rrbb * _B_Pack(b).rgrg;
              //value += _A_Pack(a).ggaa * _B_Pack(b).baba;
              value = _B_Pack(b);
              value = _A_Pack(a);

          }
          //return value;
          int t[2];
          t[0]=0;
          t[1]=0;
          return _B_Pack(t).rgba;
      }`;
    return {
      inputLayouts: inputs.map(t => handler.getOrCreateTextureLayout(t, 4, true)),
      outputLayout: handler.createTextureLayoutFromShape(outputShape, 4, outputShape, {isPacked: true}),
      samplers: ['A', 'B'],
      shaderSource,
      isInputsPacked: true,
      isOutputPacked: true,
    };
  }
  createRunData(handler: WebGLInferenceHandler, programInfo: ProgramInfo, inputs: Tensor[]): RunData {
    const inputTDs = inputs.map((t, i) => handler.getOrCreateTextureData(t, programInfo.inputLayouts[i]));
    return {
      inputTextureDatas: inputTDs,
      outputTextureData: handler.createTextureDataFromLayout(programInfo.outputLayout, inputTDs[0].tensor.type),
      uniformData: {}
    };
  }
}