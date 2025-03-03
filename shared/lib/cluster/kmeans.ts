import {
  div,
  equal,
  scalar,
  squaredDifference,
  sum,
  Tensor1D,
  tensor2d,
  Tensor2D,
  tidy
} from '@tensorflow/tfjs-core'
import { Scikit2D } from '../types'
import { convertToNumericTensor2D } from '../utils'
import { tf } from '../../globals'

/*
Next steps
1. Implement correct tol, maxIter logic
2. Implement correct nIter logic
3. Make it pass next 5 tests in sklearn test logic
*/

// Modified Fisher-Yates algorithm which takes
// a seed and selects n random numbers from a
// set of integers going from 0 to size-1
function sampleWithoutReplacement(size: number, n: number, seed?: number) {
  let curMap = new Map<number, number>()
  let finalNumbs = []
  let randoms = tf.randomUniform([n], 0, size, 'float32', seed).dataSync()
  for (let i = 0; i < randoms.length; i++) {
    randoms[i] = (randoms[i] * (size - i)) / size
    let randInt = Math.floor(randoms[i])
    let lastIndex = size - i - 1
    if (curMap.get(randInt) === undefined) {
      curMap.set(randInt, randInt)
    }
    if (curMap.get(lastIndex) === undefined) {
      curMap.set(lastIndex, lastIndex)
    }
    let holder = curMap.get(lastIndex) as number
    curMap.set(lastIndex, curMap.get(randInt) as number)
    curMap.set(randInt, holder)
    finalNumbs.push(curMap.get(lastIndex) as number)
  }

  return finalNumbs
}

export interface KMeansParams {
  /** The number of clusters for the kmeans algorithm. **default = 8** */
  nClusters?: number

  /** Initialization strategy for KMeans. Currently it only supports 'random' which selects
   * random points from the input to to be the initial centers. We will soon support 'kmeans++'
   * which is an alternative initialization strategy that speeds up convergences. **default = "random"**
   */
  init?: 'random'

  /** The number of times to run KMeans. We choose the solution which has the smallest inertia. **default = 10** */
  nInit?: number

  /** Max number of iterations for the KMeans fit. **default = 300** */
  maxIter?: number

  /** Tolerance is the number where if the KMeans doesn't generate a better solution
   * than it ceases execution. **default = 1e-4** */
  tol?: number

  /** Because there is a random element to KMeans, if you need a deterministic repeatable KMeans
   * solution (for testing or other deterministic situations), you can set the random seed here.
   * **default = undefined**
   */
  randomState?: number
}

/**
 * The KMeans algorithm clusters data by trying to separate samples into `k` groups
 * of equal variance, minimizing a criterion known as the inertia or within-cluster sum-of-squares.
 *
 * <!-- prettier-ignore-start -->
 * $$
 * \sum_{i=0}^{n}\min_{\mu_j \in C}(||x_i - \mu_j||^2)
 * $$
 *
 * @example
 * ```js
 * let X = [
 *  [1, 2],
    [1, 4],
    [4, 4],
    [4, 0]
   ]
   const kmean = new KMeans({ nClusters: 2 })
   kmean.fit(X)
   ```
 */
export class KMeans {
  nClusters: number
  init: string
  nInit?: number
  maxIter: number
  tol: number
  randomState?: number

  // Attributes
  /** The actual cluster centers found by KMeans */
  clusterCenters: Tensor2D

  /** Useful for pipelines and column transformers to have a default name for transforms */
  name = 'kmeans'

  constructor({
    nClusters = 8,
    init = 'random',
    maxIter = 300,
    tol = 0.0001,
    nInit = 10,
    randomState
  }: KMeansParams = {}) {
    this.nClusters = nClusters
    this.init = init
    this.maxIter = maxIter
    this.tol = tol
    this.randomState = randomState
    this.nInit = nInit
    this.clusterCenters = tensor2d([[]])
  }

  initCentroids(X: Tensor2D) {
    if (this.init === 'random') {
      let indices = sampleWithoutReplacement(
        X.shape[0],
        this.nClusters,
        this.randomState
      )
      this.clusterCenters = tf.gather(X, indices)
      return
    }
    throw new Error(`init ${this.init} not implemented currently`)
  }

  closestCentroid(X: Tensor2D): Tensor1D {
    return tidy(() => {
      const expandedX = tf.expandDims(X, 1)
      const expandedClusters = tf.expandDims(this.clusterCenters, 0)
      return squaredDifference(expandedX, expandedClusters).sum(2).argMin(1)
    })
  }

  updateCentroids(X: Tensor2D, nearestIndices: Tensor1D): Tensor2D {
    return tidy(() => {
      const newCentroids = []
      for (let i = 0; i < this.nClusters; i++) {
        const mask = equal(nearestIndices, scalar(i).toInt())
        const currentCentroid = div(
          // set all masked instances to 0 by multiplying the mask tensor,
          // then sum across all instances
          sum(tf.mul(tf.expandDims(mask.toFloat(), 1), X), 0),
          // divided by number of instances
          sum(mask.toFloat())
        )
        newCentroids.push(currentCentroid)
      }
      return tf.stack(newCentroids) as Tensor2D
    })
  }

  /**
   * Runs the KMeans algo over your input.
   * @param X The 2D Matrix that you wish to cluster
   */
  public fit(X: Scikit2D): KMeans {
    let XTensor2D = convertToNumericTensor2D(X)
    this.initCentroids(XTensor2D)
    for (let i = 0; i < this.maxIter; i++) {
      const centroidPicks = this.closestCentroid(XTensor2D)
      this.clusterCenters = this.updateCentroids(XTensor2D, centroidPicks)
    }
    return this
  }

  /**
   * Converts 2D input into a 1D Tensor which holds the Kmeans cluster Class label
   * @param X The 2D Matrix that you wish to cluster
   */
  public predict(X: Scikit2D): Tensor1D {
    let XTensor2D = convertToNumericTensor2D(X)
    return this.closestCentroid(XTensor2D)
  }

  public transform(X: Scikit2D): Tensor2D {
    return tidy(() => {
      const XTensor2D = convertToNumericTensor2D(X)
      const expandedX = tf.expandDims(XTensor2D, 1)
      const expandedClusters = tf.expandDims(this.clusterCenters, 0)
      return squaredDifference(expandedX, expandedClusters)
        .sum(2)
        .sqrt() as Tensor2D
    })
  }

  public fitPredict(X: Scikit2D) {
    return this.fit(X).predict(X)
  }

  public fitTransform(X: Scikit2D) {
    return this.fit(X).transform(X)
  }

  public score(X: Scikit2D): Tensor1D {
    return tidy(() => {
      const XTensor2D = convertToNumericTensor2D(X)
      const expandedX = tf.expandDims(XTensor2D, 1)
      const expandedClusters = tf.expandDims(this.clusterCenters, 0)
      return squaredDifference(expandedX, expandedClusters)
        .sum(2)
        .min(1)
        .sqrt()
        .sum()
    })
  }
}
